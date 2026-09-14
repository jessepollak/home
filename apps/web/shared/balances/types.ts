// Contract v3 for GET /api/balances. See docs/balances.md.
//
// One snapshot carries every balance Home shows: registry assets (cash, ETH,
// Invest tokens, Morpho vault shares) and positive holdings from the Codex 512
// catalog. Every feature selects from `holdings`; nothing else on the wire is a
// balance. Amounts are decimal integer strings (bigint from the boundary in).

import type { FiatCurrencyCode, RegionId } from "@/config/regions";

export const BALANCES_VERSION = 3 as const;
export const BALANCES_ROUTE = "/api/balances" as const;
export const BALANCES_CHAIN_ID = 8453 as const;
/** A price older than this is not used for balance display valuation. */
export const BALANCES_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BalancesAddress = `0x${string}`;
export type NativeAssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/native`;
export type Erc20AssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/erc20:${string}`;
export type AssetKey = NativeAssetKey | Erc20AssetKey;

/** Exact decimal: `atoms / 10^scale`. Never a JavaScript number. */
export type ExactDecimal = { atoms: string; scale: number };

export type HoldingKind = "native" | "erc20" | "vault-share";
/**
 * Provenance of a holding:
 * - `registry`: configured in config/portfolio-assets (cash, ETH, Invest, vault shares); always present.
 * - `catalog`: one of the Codex top-512 Base tokens; present only with a positive balance.
 * - `wallet`: discovered by a wallet enumerator (CDP Token Balances) outside the registry and
 *   catalog, resolved against Codex metadata by contract address; present only with a positive
 *   balance. Reserved for the "all tokens" phase (docs/balances.md §Next); no server emits it yet.
 */
export type HoldingSource = "registry" | "catalog" | "wallet";

export type HoldingBalance =
  | { status: "ready"; baseUnits: string }
  | { status: "unavailable"; baseUnits: null };

export type HoldingValueUnpricedReason =
  | "price-unavailable"
  | "price-stale"
  | "fx-unavailable"
  | "below-market-gate"
  | "no-quote-currency";

/**
 * Value in the snapshot's `quoteCurrency`. `asOf` is the price source time; display
 * valuation accepts prices up to BALANCES_PRICE_MAX_AGE_MS old (older → "price-stale").
 * Trade and borrow authorization keep their own, stricter freshness rules.
 */
export type HoldingValue =
  | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal; asOf: string }
  | { status: "unpriced"; reason: HoldingValueUnpricedReason }
  | { status: "unavailable" };

/** Value of a cash token in its own denomination (USDC → USD, IDRX → IDR). */
export type HoldingCashValue =
  | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal }
  | { status: "unpriced"; reason: Exclude<HoldingValueUnpricedReason, "below-market-gate" | "no-quote-currency"> }
  | { status: "unavailable" };

export type Holding = {
  key: AssetKey;
  /** Registry id ("usdc", "eth", "cbbtc", "morpho-steakhouse-usdc"), `catalog:${lowercaseAddress}`, or `wallet:${lowercaseAddress}`. */
  id: string;
  kind: HoldingKind;
  source: HoldingSource;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: BalancesAddress | null;
  cashCurrency: FiatCurrencyCode | null;
  /** Sanitized https URL. Registry Invest icons come from the server icon resolver; catalog and wallet images from Codex. Cash and ETH rows carry no image (the client paints a flag or the ETH mark). */
  imageUrl?: string;
  /** Vault shares only. */
  underlying?: { key: Erc20AssetKey; symbol: "USDC"; decimals: 6 };
  balance: HoldingBalance;
  /** Vault shares only: `convertToAssets(shares)` at the snapshot block. */
  underlyingBalance?: HoldingBalance;
  value: HoldingValue;
  /** Present iff `cashCurrency !== null`. */
  cashValue?: HoldingCashValue;
};

export type BalancesCoverage = {
  /** `partial` when any registry row's balance is unavailable. */
  registry: "complete" | "partial";
  /** `incomplete` when a Codex page or a catalog chunk failed; `unavailable` when no catalog could be read. */
  catalog: "complete" | "incomplete" | "unavailable";
};

export type BalancesTotal = {
  /** Computed from registry rows only; catalog rows add value when gated in and never move status. */
  status: "complete" | "partial" | "unavailable" | "no-quote-currency";
  value: ExactDecimal | null;
  currency: FiatCurrencyCode | null;
};

export type BalancesSnapshot = {
  version: typeof BALANCES_VERSION;
  owner: { address: BalancesAddress; chainId: typeof BALANCES_CHAIN_ID };
  region: RegionId;
  quoteCurrency: FiatCurrencyCode | null;
  block: { number: string; hash: `0x${string}`; timestamp: string };
  fetchedAt: string;
  holdings: Holding[];
  coverage: BalancesCoverage;
  total: BalancesTotal;
  /** Set when a required re-observe failed and the last observation is served as it was (balances.md §8). */
  stale?: true;
};

/** The verified session facts a snapshot must match before the client trusts it. */
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

export type FetchBalances = (region: RegionId, signal?: AbortSignal) => Promise<unknown>;

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
