import {
  MARKET_PRICE_HISTORY_VERSION,
  isMarketPriceRange,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "../../shared/invest/contracts/market-price-history";

const rangeSeconds: Record<MarketPriceRange, number> = {
  "1D": 86400, "1W": 604800, "1M": 2592000, "3M": 7776000, "1Y": 31536000,
};

export function syntheticPriceHistory(assetId: string, range: string, anchor: number): MarketPriceHistoryResponse | null {
  if (!assetId || !isMarketPriceRange(range)) return null;
  const end = anchor + 120_000;
  const span = rangeSeconds[range] * 1000;
  const seed = [...assetId].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 0);
  const base = assetId === "cbbtc" ? 64_000 : 80 + seed;
  const points = Array.from({ length: 241 }, (_, index) => {
    const fraction = index / 240;
    const value = base * (1 + fraction * 0.035 + Math.sin(fraction * Math.PI * 10 + seed) * 0.012);
    return { time: new Date(end - span * (1 - fraction)).toISOString(), value: value.toFixed(4) };
  });
  return {
    version: MARKET_PRICE_HISTORY_VERSION, provider: "codex", assetId: assetId as MarketPriceHistoryResponse["assetId"],
    range, currency: "USD", fetchedAt: new Date(end).toISOString(), status: "ready", points,
  };
}
