
import type { RegionId } from "@/config/regions";
import type { BalancesSnapshot } from "./contract";

export const BALANCES_VERSION = 5 as const;
export const BALANCES_CHAIN_ID = 8453 as const;
export const BALANCES_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BalancesAddress = `0x${string}`;
export type NativeAssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/native`;
export type Erc20AssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/erc20:${string}`;
export type AssetKey = NativeAssetKey | Erc20AssetKey;

export type { ExactDecimal, HoldingBalance, HoldingValue, HoldingCashValue, Holding,
  BorrowCollateralHolding, BorrowPosition, BalancesBorrow, BalancesCoverage,
  BalancesTotal, BalancesNetTotal, BalancesTotals, BalancesSnapshot } from "./contract";
/** @public keeps the response type import path that existed before the schema migration */
export type { BorrowDebtLine } from "./contract";

export type HoldingKind = "native" | "erc20" | "vault-share";
export type HoldingSource = "registry" | "catalog" | "wallet" | "borrow";
export type BorrowMarketKey = `0x${string}`;

export type HoldingValueUnpricedReason =
  | "price-unavailable"
  | "price-stale"
  | "fx-unavailable"
  | "below-market-gate"
  | "no-quote-currency"
  | "price-paused"
  | "asset-removed";

export type HoldingValueReference = { kind: "tokenized-equity"; session: "open" | "closed" };

export type BalancesSession = {
  subject: string;
  smartAccountAddress: BalancesAddress;
  chainId: typeof BALANCES_CHAIN_ID;
};

export type BalancesState =
  | { status: "unavailable"; snapshot: null; error: null }
  | { status: "loading"; snapshot: null; error: null }
  | { status: "ready"; snapshot: BalancesSnapshot; error: null; revalidating?: true }
  | { status: "error"; snapshot: null; error: "balances-unavailable" };

export type FetchBalances = (region: RegionId, signal?: AbortSignal, onStage?: (stage: "fetch" | "response") => void) => Promise<unknown>;

export function nativeAssetKey(): NativeAssetKey {
  return `eip155:${BALANCES_CHAIN_ID}/native`;
}

export function erc20AssetKey(address: string): Erc20AssetKey {
  return `eip155:${BALANCES_CHAIN_ID}/erc20:${address.toLowerCase()}`;
}

export function catalogHoldingId(address: string): `catalog:${string}` {
  return `catalog:${address.toLowerCase()}`;
}

export function walletHoldingId(address: string): `wallet:${string}` {
  return `wallet:${address.toLowerCase()}`;
}
