import { describe, expect, test } from "bun:test";
import {
  COINBASE_FX_MAX_RESPONSE_BYTES,
  CoinbaseExchangeRatesError,
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
        expect(String(input)).toBe("https://api.coinbase.com/v2/exchange-rates?currency=USD");
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

  test.each([
    ["HTTP 503", () => new Response("unavailable", { status: 503 }), "Coinbase exchange rates returned HTTP 503."],
    ["invalid base currency", () => Response.json({ data: { currency: "EUR", rates: {} } }), "Coinbase returned an invalid base currency."],
    ["invalid rate set", () => Response.json({ data: { currency: "USD", rates: null } }), "Coinbase returned an invalid rate set."],
    ["oversized declared length", () => new Response("{}", { headers: { "content-length": String(COINBASE_FX_MAX_RESPONSE_BYTES + 1) } }), "Coinbase exchange rates request failed."],
    ["oversized body", () => Response.json({ data: { currency: "USD", rates: {} }, pad: "x".repeat(COINBASE_FX_MAX_RESPONSE_BYTES) }), "Coinbase exchange rates request failed."],
    ["malformed JSON", () => new Response("{broken"), "Coinbase exchange rates request failed."],
  ] as const)("preserves %s wording and class", async (_case, response, message) => {
    const reader = createCoinbaseExchangeRatesReader({
      now: () => new Date(NOW),
      fetchImpl: (async () => response()) as unknown as typeof fetch,
    });
    const error = await reader().then(() => null, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(CoinbaseExchangeRatesError);
    expect((error as Error).message).toBe(message);
  });

  test("times out a stalled fetch with the exchange rates error class", async () => {
    let sawAbort = false;
    const reader = createCoinbaseExchangeRatesReader({
      now: () => new Date(NOW),
      timeoutMs: 10,
      fetchImpl: (async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })) as typeof fetch,
    });
    const error = await reader().then(() => null, (reason: unknown) => reason);
    expect(sawAbort).toBe(true);
    expect(error).toBeInstanceOf(CoinbaseExchangeRatesError);
    expect((error as Error).message).toBe("Coinbase exchange rates timed out.");
  });
});
