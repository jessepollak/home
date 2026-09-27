export const STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION = 1 as const;

export type StockTradeEligibilityResponse = {
  version: typeof STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION;
  buy: "eligible" | "restricted";
  sell: "eligible";
};

export function parseStockTradeEligibilityResponse(value: unknown): StockTradeEligibilityResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).sort().join(",") !== "buy,sell,version") return null;
  const response = value as Record<string, unknown>;
  if (response.version !== STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION ||
    (response.buy !== "eligible" && response.buy !== "restricted") || response.sell !== "eligible") return null;
  return { version: STOCK_TRADE_ELIGIBILITY_CONTRACT_VERSION, buy: response.buy, sell: "eligible" };
}
