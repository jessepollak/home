import { getDirectPortfolioAssets } from "@/config/portfolio-assets";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import {
  formatExactPresentationTokenAmount,
  formatUnsignedTokenAmount,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import type { PortfolioAssetBalance } from "@/shared/portfolio/types";
import {
  TransferExecutionError,
  type TransferAsset,
  type TransferAssetId,
  type TransferRequest,
} from "./types";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const decimalAmountPattern = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

const transferAssetList: TransferAsset[] = getDirectPortfolioAssets().map((asset) => ({
  id: asset.id,
  assetKey: asset.assetKey,
  name: asset.name,
  symbol: asset.symbol,
  decimals: asset.decimals,
  kind: asset.kind,
  contractAddress: asset.contractAddress,
  cashCurrency: asset.cashCurrency,
}));

if (new Set(transferAssetList.map((asset) => asset.id)).size !== transferAssetList.length) {
  throw new Error("The transferable catalog contains a duplicate asset id.");
}

export const TRANSFER_ASSETS: Readonly<Record<string, TransferAsset>> = Object.freeze(
  Object.fromEntries(transferAssetList.map((asset) => [asset.id, Object.freeze(asset)])),
);

export function getTransferAssets(): readonly TransferAsset[] {
  return transferAssetList;
}

export function getTransferAsset(assetId: unknown): TransferAsset | null {
  return typeof assetId === "string" ? TRANSFER_ASSETS[assetId] ?? null : null;
}

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
  const asset = getTransferAsset(assetId);
  if (!asset) throw new TransferExecutionError("invalid-request");
  if (asset.id === "usdc") {
    return formatUsdStablecoinAmount(amountBaseUnits, asset.decimals);
  }
  return formatExactPresentationTokenAmount(
    amountBaseUnits,
    asset.decimals,
    asset.symbol,
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
  if (
    !value ||
    typeof value.assetId !== "string" ||
    typeof value.recipient !== "string" ||
    typeof value.amountBaseUnits !== "string"
  ) {
    throw new TransferExecutionError("invalid-request");
  }
  const asset = getTransferAsset(value.assetId);
  if (!asset) {
    throw new TransferExecutionError("invalid-request");
  }
  const recipient = normalizeTransferRecipient(value.recipient);
  if (
    asset.kind === "erc20" &&
    asset.contractAddress !== null &&
    recipient === asset.contractAddress.toLowerCase()
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

export function encodeErc20Transfer(
  token: `0x${string}`,
  recipient: `0x${string}`,
  amountBaseUnits: bigint,
): { to: `0x${string}`; data: `0x${string}`; value: bigint } {
  if (!addressPattern.test(token) || /^0x0{40}$/i.test(token)) {
    throw new TransferExecutionError("invalid-request");
  }
  const normalizedRecipient = normalizeTransferRecipient(recipient);
  if (amountBaseUnits <= BigInt(0) || amountBaseUnits > UINT256_MAX) {
    throw new TransferExecutionError("invalid-request");
  }
  return {
    to: token.toLowerCase() as `0x${string}`,
    data: `${ERC20_TRANSFER_SELECTOR}${normalizedRecipient.slice(2).padStart(64, "0")}${amountBaseUnits
      .toString(16)
      .padStart(64, "0")}`,
    value: BigInt(0),
  };
}

export function encodeUsdcTransfer(
  recipient: `0x${string}`,
  amountBaseUnits: bigint,
): `0x${string}` {
  const usdc = getTransferAsset("usdc");
  if (!usdc?.contractAddress) throw new TransferExecutionError("unavailable");
  return encodeErc20Transfer(usdc.contractAddress, recipient, amountBaseUnits).data;
}

/**
 * Decodes a prepared send action back into its catalog transfer request while
 * rechecking that its server-authored target, calldata, value, and amount agree.
 */
export function transferRequestFromAction(
  action: PreparedMoneyAction,
): TransferRequest | null {
  if (action.kind !== "send" || action.calls.length !== 1) return null;
  const spend = action.amounts.find((entry) => entry.direction === "spend");
  const asset = getTransferAsset(spend?.assetId);
  if (!spend || !asset || spend.symbol !== asset.symbol || spend.decimals !== asset.decimals) {
    return null;
  }
  const call = action.calls[0];
  let recipient: `0x${string}`;
  if (asset.kind === "native") {
    if (call.data !== "0x" || call.value !== spend.amountBaseUnits) return null;
    recipient = call.to;
  } else {
    if (!asset.contractAddress || call.to.toLowerCase() !== asset.contractAddress.toLowerCase() || call.value !== "0") {
      return null;
    }
    if (!call.data.startsWith(ERC20_TRANSFER_SELECTOR) || call.data.length !== 138) return null;
    recipient = `0x${call.data.slice(34, 74)}` as `0x${string}`;
    try {
      if (encodeErc20Transfer(asset.contractAddress, recipient, BigInt(spend.amountBaseUnits)).data !== call.data.toLowerCase()) {
        return null;
      }
    } catch {
      return null;
    }
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
