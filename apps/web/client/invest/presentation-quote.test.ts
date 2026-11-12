import { present } from "@/tests/helpers/async";
import { describe, expect, test } from "bun:test";
import { formatPresentationFiat } from "@/shared/formatting/presentation-fiat";
import { getMarketDisplay, type MarketDataState } from "@/shared/invest/invest-market";
import { presentationQuoteForRegion, type PresentationFxQuote } from "./presentation-quote";

const fx: PresentationFxQuote[] = [
  { quoteCurrency: "BRL", quoteUnitsPerUsd: { atoms: "5", scale: 0 }, status: "fresh" },
  { quoteCurrency: "EUR", quoteUnitsPerUsd: { atoms: "92", scale: 2 }, status: "fresh" },
];
const market: MarketDataState = {
  status: "ready", snapshots: [{
    assetId: "bitcoin", displayPrice: "$1234.56", sourceLabel: "Market", asOf: "2026-10-01T12:00:00.000Z",
    sourceUrl: "https://example.com", session: "open",
  }],
};

describe("independent invest display currency", () => {
  test("uses USD under BR without applying the country's FX quote", () => {
    const quote = presentationQuoteForRegion("BR", fx, "USD");
    expect(quote.valueCurrency).toBe("USD");
    expect(quote.quoteUnitsPerUsd).toEqual({ atoms: "1", scale: 0 });
    expect(getMarketDisplay("bitcoin", market, quote).value).toBe("$1.234,56");
    expect(formatPresentationFiat({ atoms: "123456", scale: 2 }, present(quote.valueCurrency), 2, "BR")).toBe("$1.234,56");
  });

  test("uses fresh FX for the selected currency rather than the country's currency", () => {
    const quote = presentationQuoteForRegion("BR", fx, "EUR");
    expect(quote.valueCurrency).toBe("EUR");
    expect(quote.quoteUnitsPerUsd).toEqual({ atoms: "92", scale: 2 });
    expect(getMarketDisplay("bitcoin", market, quote).value).toBe("€1.135,80");
  });

  test.each([
    { quotes: undefined }, { quotes: [] },
    { quotes: [{ quoteCurrency: "EUR", quoteUnitsPerUsd: { atoms: "92", scale: 2 }, status: "unavailable" }] satisfies PresentationFxQuote[] },
  ])(
    "does not relabel USD prices when selected-currency FX is missing", ({ quotes }) => {
      const quote = presentationQuoteForRegion("BR", quotes, "EUR");
      expect(quote.valueCurrency).toBe("EUR");
      expect(quote.quoteUnitsPerUsd).toBeNull();
      expect(getMarketDisplay("bitcoin", market, quote).value).toBe("—");
    },
  );

  test("keeps existing country-default and GLOBAL behavior", () => {
    expect(presentationQuoteForRegion("BR", fx).valueCurrency).toBe("BRL");
    expect(presentationQuoteForRegion("GLOBAL", fx, null).valueCurrency).toBe("USD");
    expect(getMarketDisplay("bitcoin", market, presentationQuoteForRegion("GLOBAL", fx, null)).value).toBe("$1,234.56");
  });
});
