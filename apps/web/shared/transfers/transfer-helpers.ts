import { getDirectPortfolioAssets, type DirectPortfolioAsset } from "@/config/portfolio-assets";
import { currencyRecordForContract } from "@/shared/currencies/registry";
import type { CurrencyRepresentation } from "@/shared/currencies/types";
import {
  formatExactPresentationTokenAmount,
  formatUnsignedTokenAmount,
  formatUsdStablecoinAmount,
} from "@/shared/formatting";
import { normalizeResolvedRecipientAddress } from "./recipient-address";
import {
  TransferExecutionError,
  type TransferAsset,
  type TransferAssetId,
} from "./types";

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const decimalAmountPattern = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const decimalIntegerPattern = /^(?:0|[1-9][0-9]*)$/;
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

/** @public Send admission predicate exercised by transfer-helpers.test.ts. */
export function isTransferAssetAllowed(
  asset: DirectPortfolioAsset,
  record: CurrencyRepresentation | null = currencyRecordForContract(asset.contractAddress),
): boolean {
  return !record || record.send.state === "approved";
}

const transferAssetList: TransferAsset[] = getDirectPortfolioAssets().filter((asset) => isTransferAssetAllowed(asset)).map((asset) => ({
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

/** @public Deferred transfer barrel API pending #687 cleanup. */
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
  const normalized = normalizeResolvedRecipientAddress(value);
  if (!normalized) throw new TransferExecutionError("invalid-request");
  return normalized;
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

/** @public Transfer formatting seam retained for #687 cleanup. */
export function formatTransferAmount(
  amountBaseUnits: string,
  decimals: number,
): string {
  readBaseUnits(amountBaseUnits);
  return formatUnsignedTokenAmount(amountBaseUnits, decimals);
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
    data: `${ERC20_TRANSFER_SELECTOR}${normalizedRecipient.slice(2).toLowerCase().padStart(64, "0")}${amountBaseUnits
      .toString(16)
      .padStart(64, "0")}`,
    value: BigInt(0),
  };
}

/** @public Transfer calldata seam retained for #687 cleanup. */
export function encodeUsdcTransfer(
  recipient: `0x${string}`,
  amountBaseUnits: bigint,
): `0x${string}` {
  const usdc = getTransferAsset("usdc");
  if (!usdc?.contractAddress) throw new TransferExecutionError("unavailable");
  return encodeErc20Transfer(usdc.contractAddress, recipient, amountBaseUnits).data;
}

export function readBaseUnits(value: string, requirePositive = false): bigint {
  if (!decimalIntegerPattern.test(value)) {
    throw new TransferExecutionError("invalid-request");
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX || (requirePositive && parsed === BigInt(0))) {
    throw new TransferExecutionError("invalid-request");
  }
  return parsed;
}
