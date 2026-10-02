import { parseAddress, parseHash32, type Address } from "@/shared/chain/hex";
import type {
  PreparedMoneyAction,
  SavingsMoneyActionMetadata,
} from "@/shared/money-actions/types";

export type SavingsPreparedReview = {
  operation: "deposit" | "withdraw";
  vaultAddress: Address;
  vaultName: string;
  network: { name: "Base"; chainId: 8453 };
  feeWad: string;
  expiresAt: string;
  exactUsdcBaseUnits: string;
  previewSharesBaseUnits: string;
  minimumSharesBaseUnits: string | null;
  shareDecimals: number;
  limitBaseUnits: string;
  exchangeConstraint: SavingsMoneyActionMetadata["exchangeConstraint"];
  discoveryRate: SavingsMoneyActionMetadata["discoveryRate"];
  sourceBlockNumber: string;
};

const integer = /^(?:0|[1-9][0-9]*)$/;
const decimal = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const WAD = BigInt("1000000000000000000");

export function readSavingsPreparedReview(
  action: PreparedMoneyAction,
): SavingsPreparedReview | null {
  const metadata = action.metadata;
  if (!isSavingsMetadata(metadata) || metadata.exchangeConstraint === "deposit-preview-no-minimum-shares") return null;
  const expectedKind = metadata.operation === "deposit"
    ? "savings-deposit"
    : "savings-withdraw";
  if (action.kind !== expectedKind || !readIso(action.expiresAt)) return null;
  const amounts = action.amounts.filter((amount) => Boolean(amount) && typeof amount === "object");

  const usdc = amounts.find((amount) =>
    amount.symbol === "USDC" &&
    amount.decimals === 6 &&
    amount.direction === (metadata.operation === "deposit" ? "spend" : "receive")
  );
  const shares = amounts.find((amount) =>
    amount.symbol === "vault shares" &&
    amount.estimated === true &&
    amount.direction === (metadata.operation === "deposit" ? "receive" : "spend")
  );
  const vaultAddress = parseAddress(metadata.vaultAddress);
  if (
    !vaultAddress ||
    !usdc ||
    !shares ||
    typeof usdc.amountBaseUnits !== "string" ||
    typeof shares.amountBaseUnits !== "string" ||
    !integer.test(usdc.amountBaseUnits) ||
    usdc.amountBaseUnits === "0" ||
    shares.amountBaseUnits !== metadata.previewSharesBaseUnits ||
    shares.decimals !== metadata.shareDecimals
  ) {
    return null;
  }

  return {
    operation: metadata.operation,
    vaultAddress,
    vaultName: metadata.vaultName,
    network: metadata.network,
    feeWad: metadata.feeWad,
    expiresAt: action.expiresAt,
    exactUsdcBaseUnits: usdc.amountBaseUnits,
    previewSharesBaseUnits: metadata.previewSharesBaseUnits,
    minimumSharesBaseUnits: metadata.operation === "deposit" ? metadata.minimumSharesBaseUnits! : null,
    shareDecimals: metadata.shareDecimals,
    limitBaseUnits: metadata.limitBaseUnits,
    exchangeConstraint: metadata.exchangeConstraint,
    discoveryRate: metadata.discoveryRate,
    sourceBlockNumber: metadata.source.blockNumber,
  };
}

export function isSavingsMetadata(
  value: unknown,
): value is SavingsMoneyActionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const source = item.source;
  const network = item.network;
  const discoveryRate = item.discoveryRate;
  const operation = item.operation;
  const validConstraint = operation === "withdraw"
    ? item.exchangeConstraint === "withdraw-exact-assets-or-revert" && item.minimumSharesBaseUnits === undefined
    : (item.exchangeConstraint === "deposit-preview-no-minimum-shares" && item.minimumSharesBaseUnits === undefined) ||
      (item.exchangeConstraint === "deposit-minimum-shares-or-revert" &&
        typeof item.minimumSharesBaseUnits === "string" &&
        integer.test(item.minimumSharesBaseUnits) && item.minimumSharesBaseUnits !== "0" &&
        typeof item.previewSharesBaseUnits === "string" && integer.test(item.previewSharesBaseUnits) &&
        BigInt(item.minimumSharesBaseUnits) <= BigInt(item.previewSharesBaseUnits));

  return item.product === "savings" &&
    (operation === "deposit" || operation === "withdraw") &&
    parseAddress(item.vaultAddress) !== null &&
    typeof item.vaultName === "string" && item.vaultName.trim() === item.vaultName &&
    item.vaultName.length > 0 && item.vaultName.length <= 128 &&
    Boolean(network && typeof network === "object" && !Array.isArray(network) &&
      (network as Record<string, unknown>).name === "Base" &&
      (network as Record<string, unknown>).chainId === 8453) &&
    typeof item.feeWad === "string" && integer.test(item.feeWad) &&
    BigInt(item.feeWad) <= WAD &&
    typeof item.limitBaseUnits === "string" && integer.test(item.limitBaseUnits) &&
    typeof item.previewSharesBaseUnits === "string" &&
    integer.test(item.previewSharesBaseUnits) && item.previewSharesBaseUnits !== "0" &&
    typeof item.shareDecimals === "number" && Number.isInteger(item.shareDecimals) &&
    item.shareDecimals >= 0 && item.shareDecimals <= 255 &&
    validConstraint &&
    isDiscoveryRate(discoveryRate) &&
    Boolean(source && typeof source === "object" && !Array.isArray(source) &&
      typeof (source as Record<string, unknown>).blockNumber === "string" &&
      integer.test((source as Record<string, unknown>).blockNumber as string) &&
      typeof (source as Record<string, unknown>).blockHash === "string" &&
      parseHash32((source as Record<string, unknown>).blockHash) !== null &&
      typeof (source as Record<string, unknown>).blockTimestamp === "string" &&
      integer.test((source as Record<string, unknown>).blockTimestamp as string));
}

function isDiscoveryRate(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rate = value as Record<string, unknown>;
  if (rate.status === "unavailable") {
    return rate.netApy === null && rate.fetchedAt === null && rate.stateAsOf === null;
  }
  return (rate.status === "current" || rate.status === "stale") &&
    typeof rate.netApy === "string" && decimal.test(rate.netApy) &&
    Number.isFinite(Number(rate.netApy)) &&
    readIso(rate.fetchedAt) && readIso(rate.stateAsOf);
}

function readIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
