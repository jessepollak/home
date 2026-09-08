import type { InvestAssetId } from "@/config/invest-assets";

export const MARKET_PRICE_HISTORY_VERSION = 1 as const;
export const MARKET_PRICE_RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;

export type MarketPriceRange = (typeof MARKET_PRICE_RANGES)[number];

export type MarketPriceHistoryPoint = {
  time: string;
  value: string;
};

export type MarketPriceHistoryResponse = {
  version: typeof MARKET_PRICE_HISTORY_VERSION;
  provider: "codex";
  assetId: InvestAssetId | null;
  range: MarketPriceRange | null;
  fetchedAt: string | null;
  status: "ready" | "empty" | "unavailable" | "error";
  points: readonly MarketPriceHistoryPoint[];
  unavailableReason?: "not-configured" | "unknown-asset" | "invalid-range";
};

export function isMarketPriceRange(value: string): value is MarketPriceRange {
  return (MARKET_PRICE_RANGES as readonly string[]).includes(value);
}
