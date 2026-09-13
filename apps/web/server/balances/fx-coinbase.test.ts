import { describe, expect, test } from "bun:test";
import {
  COINBASE_EXCHANGE_RATES_URL,
  createCoinbaseExchangeRatesReader,
  supportedFiatCurrencies,
} from "./fx-coinbase";

const NOW = "2026-09-08T12:00:00.000Z";

describe("Coinbase exchange rates", () => {
  test("parses all configured fiat and ETH decimal strings with retrieval-time provenance and a 60s cache", async () => {
    let calls = 0;
    let currentTime = Date.parse(NOW);
    const rates = Object.fromEntries(
      supportedFiatCurrencies.map((currency, index) => [
        currency,
        index === 0 ? "123456789.123456789" : "1",
      ]),
    );
    const reader = createCoinbaseExchangeRatesReader({
      now: () => new Date(currentTime),
      fetchImpl: (async (input) => {
        calls += 1;
        expect(String(input)).toBe(COINBASE_EXCHANGE_RATES_URL);
        return Response.json({
          data: { currency: "USD", rates: { ...rates, ETH: "0.0005" } },
        });
      }) as typeof fetch,
    });

    const first = await reader();
    expect(first.quotes).toHaveLength(19);
    expect(first.quotes[0]).toMatchObject({
      sourceValue: "123456789.123456789",
      quoteUnitsPerUsd: { atoms: "123456789123456789", scale: 9 },
      status: "fresh",
      source: { asOf: null, timeBasis: "retrieved-at" },
    });
    expect(first.nativeEthQuote).toMatchObject({
      sourceValue: "0.0005",
      assetUnitsPerUsd: { atoms: "5", scale: 4 },
    });
    currentTime += 60_000;
    expect(await reader()).toBe(first);
    expect(calls).toBe(1);
  });
});
