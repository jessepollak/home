
import type { FiatCurrencyCode, RegionId } from "@/config/regions";

export const BALANCES_VERSION = 4 as const;
export const BALANCES_CHAIN_ID = 8453 as const;
export const BALANCES_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type BalancesAddress = `0x${string}`;
export type NativeAssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/native`;
export type Erc20AssetKey = `eip155:${typeof BALANCES_CHAIN_ID}/erc20:${string}`;
export type AssetKey = NativeAssetKey | Erc20AssetKey;

export type ExactDecimal = { atoms: string; scale: number };

export type HoldingKind = "native" | "erc20" | "vault-share";
export type HoldingSource = "registry" | "catalog" | "wallet" | "borrow";
export type BorrowMarketKey = `0x${string}`;

export type HoldingBalance =
  | { status: "ready"; baseUnits: string }
  | { status: "unavailable"; baseUnits: null };

export type HoldingValueUnpricedReason =
  | "price-unavailable"
  | "price-stale"
  | "fx-unavailable"
  | "below-market-gate"
  | "no-quote-currency";

export type HoldingValue =
  | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal; asOf: string }
  | { status: "unpriced"; reason: HoldingValueUnpricedReason }
  | { status: "unavailable" };

export type HoldingCashValue =
  | { status: "priced"; currency: FiatCurrencyCode; amount: ExactDecimal }
  | { status: "unpriced"; reason: Exclude<HoldingValueUnpricedReason, "below-market-gate" | "no-quote-currency"> }
  | { status: "unavailable" };

export type Holding = {
  key: AssetKey;
  id: string;
  kind: HoldingKind;
  source: HoldingSource;
  name: string;
  symbol: string;
  decimals: number;
  contractAddress: BalancesAddress | null;
  cashCurrency: FiatCurrencyCode | null;
  imageUrl?: string;
  underlying?: { key: Erc20AssetKey; symbol: "USDC"; decimals: 6 };
  balance: HoldingBalance;
  underlyingBalance?: HoldingBalance;
  value: HoldingValue;
  cashValue?: HoldingCashValue;
  collateral?: { marketId: BorrowMarketKey };
};

export type BorrowCollateralHolding = Holding & {
  kind: "erc20";
  source: "borrow";
  collateral: { marketId: BorrowMarketKey };
  balance: { status: "ready"; baseUnits: string };
};

export type BorrowDebtLine = {
  sign: -1;
  marketId: BorrowMarketKey;
  asset: { key: Erc20AssetKey; name: string; symbol: string; decimals: number };
  balance: { status: "ready"; baseUnits: string };
  value: HoldingValue;
};

export type BorrowPosition = {
  marketId: BorrowMarketKey;
  collateral: BorrowCollateralHolding;
  debt: BorrowDebtLine;
  borrowAprWad: string;
};

export type BalancesBorrow = {
  coverage: "complete" | "partial";
  positions: BorrowPosition[];
};

export type BalancesCoverage = {
  registry: "complete" | "partial";
  catalog: "complete" | "incomplete" | "unavailable";
};

export type BalancesTotal = {
  status: "complete" | "partial" | "unavailable" | "no-quote-currency";
  value: ExactDecimal | null;
  currency: FiatCurrencyCode | null;
};

export type BalancesNetTotal = BalancesTotal & { negative: boolean };

export type BalancesTotals = {
  cash: BalancesTotal;
  investments: BalancesTotal;
  borrow: BalancesTotal;
  net: BalancesNetTotal;
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
  borrow: BalancesBorrow;
  totals: BalancesTotals;
  stale?: true;
};

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
