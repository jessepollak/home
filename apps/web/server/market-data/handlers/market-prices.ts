import {
  createErrorMarketPricesResponse,
  getCodexMarketPrices,
} from "@/server/market-data/codex/client";
import type {
  MarketPricesFxQuote,
  MarketPricesResponse,
} from "@/shared/invest/public-contract";
import type { FxQuote } from "@/shared/portfolio/valuation-types";

type MarketPricesReader = () => Promise<MarketPricesResponse>;
type ExchangeRatesReader = () => Promise<{ quotes: readonly FxQuote[] }>;

export function createMarketPricesHandler(
  readMarketPrices: MarketPricesReader = getCodexMarketPrices,
  readExchangeRates: ExchangeRatesReader | null = null,
) {
  return async function GET() {
    try {
      const [payload, rates] = await Promise.all([
        readMarketPrices(),
        readExchangeRates
          ? readExchangeRates().catch(() => null)
          : Promise.resolve(null),
      ]);
      const fx = rates ? presentationFxQuotes(rates.quotes) : undefined;
      const body: MarketPricesResponse = fx ? { ...payload, fx } : payload;
      const cacheControl = payload.unavailableReason
        ? "public, max-age=30"
        : "public, max-age=30, stale-while-revalidate=30";
      return Response.json(body, {
        headers: { "Cache-Control": cacheControl },
      });
    } catch {
      return Response.json(createErrorMarketPricesResponse(), {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
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
