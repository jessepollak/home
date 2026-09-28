import "server-only";

import {
  createErrorMarketPricesResponse,
  getCodexMarketPrices,
} from "@/server/market-data/codex/client";
import type { MarketDataState } from "@/shared/invest/invest-market";
import type {
  MarketPricesFxQuote,
  MarketPricesResponse,
} from "@/shared/invest/contracts/market-prices";
import type { FxQuote } from "@/shared/balances/quotes";

type MarketPricesReader = () => Promise<MarketPricesResponse>;
type ExchangeRatesReader = () => Promise<{ quotes: readonly FxQuote[] }>;
type StockMarketReader = () => Promise<MarketDataState>;

export function createMarketPricesHandler(
  readMarketPrices: MarketPricesReader = getCodexMarketPrices,
  readExchangeRates: ExchangeRatesReader | null = null,
  readStockMarket: StockMarketReader | null = null,
) {
  return async function GET() {
    try {
      const [codex, stock, rates] = await Promise.all([
        readMarketPrices().catch(() => null),
        readStockMarket ? readStockMarket().catch(() => null) : Promise.resolve(null),
        readExchangeRates
          ? readExchangeRates().catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!codex) return errorResponse(stock);
      const payload = withStockMarket(codex, stock);
      const fx = rates ? presentationFxQuotes(rates.quotes) : undefined;
      const body: MarketPricesResponse = fx ? { ...payload, fx } : payload;
      const cacheControl = payload.unavailableReason
        ? "public, max-age=30"
        : "public, max-age=30, stale-while-revalidate=30";
      return Response.json(body satisfies MarketPricesResponse, {
        headers: { "Cache-Control": cacheControl },
      });
    } catch {
      return errorResponse(null);
    }
  };
}

function withStockMarket(
  payload: MarketPricesResponse,
  stock: MarketDataState | null,
): MarketPricesResponse {
  return stock ? { ...payload, markets: { ...payload.markets, stock } } : payload;
}

function errorResponse(stock: MarketDataState | null) {
  return Response.json(
    withStockMarket(createErrorMarketPricesResponse(), stock) satisfies MarketPricesResponse,
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

function presentationFxQuotes(
  quotes: readonly FxQuote[],
): MarketPricesFxQuote[] {
  return quotes.map((quote) => ({
    quoteCurrency: quote.quoteCurrency,
    quoteUnitsPerUsd:
      quote.status === "fresh" ? quote.quoteUnitsPerUsd : null,
    status:
      quote.status === "fresh" && quote.quoteUnitsPerUsd
        ? "fresh"
        : "unavailable",
  }));
}
