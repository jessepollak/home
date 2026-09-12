import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  formatExactPresentationTokenAmount,
  formatUnsignedTokenAmount,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import {
  PORTFOLIO_BASE_USDC_ADDRESS,
  type PortfolioAssetBalance,
} from "@/shared/portfolio/types";
import {
  TransferExecutionError,
  type TransferAssetId,
  type TransferRequest,
} from "./types";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const decimalAmountPattern = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;

export const TRANSFER_ASSETS = {
  usdc: { symbol: "USDC", decimals: 6 },
  eth: { symbol: "ETH", decimals: 18 },
} as const satisfies Record<
  TransferAssetId,
  { symbol: string; decimals: number }
>;

export function isTransferRecipient(value: string): boolean {
  try {
    normalizeTransferRecipient(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTransferRecipient(value: string): `0x${string}` {
  const normalized = value.trim();
  if (
    !addressPattern.test(normalized) ||
    /^0x0{40}$/i.test(normalized)
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  return normalized.toLowerCase() as `0x${string}`;
}

export function parseTransferAmount(
  value: string,
  decimals: number,
): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TransferExecutionError("invalid-request");
  }

  const normalized = value.trim();
  const match = decimalAmountPattern.exec(normalized);
  if (!match) {
    throw new TransferExecutionError("invalid-request");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new TransferExecutionError("invalid-request");
  }

  const baseUnits = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  if (baseUnits <= BigInt(0) || baseUnits > UINT256_MAX) {
    throw new TransferExecutionError("invalid-request");
  }
  return baseUnits.toString(10);
}

export function formatSendConfirmAmount(
  amountBaseUnits: string,
  assetId: TransferAssetId,
): string {
  readBaseUnits(amountBaseUnits);
  if (assetId === "usdc") {
    return formatUsdStablecoinAmount(
      amountBaseUnits,
      TRANSFER_ASSETS.usdc.decimals,
    );
  }
  return formatExactPresentationTokenAmount(
    amountBaseUnits,
    TRANSFER_ASSETS.eth.decimals,
    TRANSFER_ASSETS.eth.symbol,
    { useNoBreakSpace: true },
  );
}

export function formatTransferAmount(
  amountBaseUnits: string,
  decimals: number,
): string {
  readBaseUnits(amountBaseUnits);
  return formatUnsignedTokenAmount(amountBaseUnits, decimals);
}

export function assertTransferRequest(value: TransferRequest): void {
  if (!(value.assetId in TRANSFER_ASSETS)) {
    throw new TransferExecutionError("invalid-request");
  }
  const recipient = normalizeTransferRecipient(value.recipient);
  if (
    value.assetId === "usdc" &&
    recipient === PORTFOLIO_BASE_USDC_ADDRESS.toLowerCase()
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  readBaseUnits(value.amountBaseUnits, true);
}

export function findTransferBalance(
  assets: PortfolioAssetBalance[],
  assetId: TransferAssetId,
): bigint {
  const asset = assets.find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new TransferExecutionError("unavailable");
  }
  return readBaseUnits(asset.balanceBaseUnits);
}

export function encodeUsdcTransfer(
  recipient: `0x${string}`,
  amountBaseUnits: bigint,
): `0x${string}` {
  const normalizedRecipient = normalizeTransferRecipient(recipient);
  if (amountBaseUnits <= BigInt(0) || amountBaseUnits > UINT256_MAX) {
    throw new TransferExecutionError("invalid-request");
  }
  return `0xa9059cbb${normalizedRecipient.slice(2).padStart(64, "0")}${amountBaseUnits
    .toString(16)
    .padStart(64, "0")}`;
}

/**
 * Decodes a prepared "send" money action back into its transfer request.
 * ERC-20 (USDC) sends carry the recipient in the `transfer(address,uint256)`
 * calldata while `call.to` is the token contract; native ETH sends use
 * `call.to` directly as the recipient.
 */
export function transferRequestFromAction(
  action: PreparedMoneyAction,
): TransferRequest | null {
  if (action.kind !== "send" || action.calls.length !== 1) return null;
  const spend = action.amounts.find((entry) => entry.direction === "spend");
  if (!spend || (spend.assetId !== "usdc" && spend.assetId !== "eth")) return null;
  const call = action.calls[0];
  let recipient: `0x${string}`;
  if (spend.assetId === "eth") {
    recipient = call.to;
  } else {
    if (!call.data.startsWith("0xa9059cbb") || call.data.length !== 138) return null;
    recipient = `0x${call.data.slice(34, 74)}` as `0x${string}`;
  }
  try {
    const request = {
      assetId: spend.assetId,
      recipient,
      amountBaseUnits: spend.amountBaseUnits,
    } satisfies TransferRequest;
    assertTransferRequest(request);
    return request;
  } catch {
    return null;
  }
}

function readBaseUnits(value: string, requirePositive = false): bigint {
  if (!decimalIntegerPattern.test(value)) {
    throw new TransferExecutionError("invalid-request");
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX || (requirePositive && parsed === BigInt(0))) {
    throw new TransferExecutionError("invalid-request");
  }
  return parsed;
}
