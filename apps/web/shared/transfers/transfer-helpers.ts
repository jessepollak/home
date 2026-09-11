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
  if (assetId === "usdc") {
    const exact = formatTransferAmount(amountBaseUnits, TRANSFER_ASSETS.usdc.decimals);
    const [whole, fraction = ""] = exact.split(".");
    return fraction.length <= 2
      ? `$${whole}.${fraction.padEnd(2, "0")}`
      : `$${exact}`;
  }
  return `${formatTransferAmount(amountBaseUnits, TRANSFER_ASSETS.eth.decimals)} ETH`;
}

export function formatTransferAmount(
  amountBaseUnits: string,
  decimals: number,
): string {
  const amount = readBaseUnits(amountBaseUnits);
  const padded = amount.toString(10).padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
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

export function buildTransferCall(request: TransferRequest): {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
} {
  assertTransferRequest(request);
  const amount = readBaseUnits(request.amountBaseUnits, true);

  if (request.assetId === "eth") {
    return { to: request.recipient, value: amount, data: "0x" };
  }

  return {
    to: PORTFOLIO_BASE_USDC_ADDRESS,
    value: BigInt(0),
    data: encodeUsdcTransfer(request.recipient, amount),
  };
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
