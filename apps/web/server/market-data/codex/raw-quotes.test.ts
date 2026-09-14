import { describe, expect, test } from "bun:test";
import { PORTFOLIO_USDC_ASSET_KEY } from "@/config/portfolio-assets";
import { BALANCES_PRICE_MAX_AGE_MS } from "@/shared/balances/types";
import {
  CODEX_SHARED_READER_MAX,
  codexSharedReaderCountForTests,
  createCodexRawQuotesReader,
  getCodexRawQuotes,
  resetCodexSharedReadersForTests,
} from "./raw-quotes";

const ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const NOW = "2026-09-08T12:00:00.000Z";
const NOW_SECONDS = String(Date.parse(NOW) / 1_000);
const input = {
  assetKey: PORTFOLIO_USDC_ASSET_KEY,
  address: ADDRESS,
  networkId: 8453 as const,
};

describe("Codex raw quotes", () => {
  test("bounds shared readers with least-recently-used eviction", async () => {
    const previousKey = process.env.CODEX_API_KEY;
    delete process.env.CODEX_API_KEY;
    resetCodexSharedReadersForTests();
    try {
      for (let index = 1; index <= CODEX_SHARED_READER_MAX + 1; index += 1) {
        const address = `0x${index.toString(16).padStart(40, "0")}` as const;
        await getCodexRawQuotes([{
          assetKey: `eip155:8453/erc20:${address}`,
          address,
          networkId: 8453,
        }]);
      }
      expect(codexSharedReaderCountForTests()).toBe(CODEX_SHARED_READER_MAX);
    } finally {
      if (previousKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = previousKey;
      resetCodexSharedReadersForTests();
    }
  });

  test("retains the exact raw decimal and exact contract/time provenance", async () => {
    const reader = createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: (async () =>
        new Response(
          `{"data":{"getTokenPrices":[{"address":"${ADDRESS}","networkId":8453,"priceUsd":1.0000000000000000001,"timestamp":${NOW_SECONDS}}]}}`,
        )),
    });

    expect(await reader()).toEqual([
      expect.objectContaining({
        assetKey: PORTFOLIO_USDC_ASSET_KEY,
        sourceValue: "1.0000000000000000001",
        unitPrice: { atoms: "10000000000000000001", scale: 19 },
        status: "fresh",
        source: expect.objectContaining({
          asOf: NOW,
          timeBasis: "provider-as-of",
        }),
      }),
    ]);
  });

  test.each([
    ["Invest default", undefined, 3 * 60 * 60 * 1_000, "stale"],
    ["balances 3 hours", BALANCES_PRICE_MAX_AGE_MS, 3 * 60 * 60 * 1_000, "fresh"],
    ["balances 30 hours", BALANCES_PRICE_MAX_AGE_MS, 30 * 60 * 60 * 1_000, "stale"],
  ] as const)("applies the %s freshness window", async (_name, freshnessMs, ageMs, status) => {
    const timestamp = String((Date.parse(NOW) - ageMs) / 1_000);
    const row = `{"address":"${ADDRESS}","networkId":8453,"priceUsd":1,"timestamp":${timestamp}}`;
    const result = await createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      ...(freshnessMs === undefined ? {} : { freshnessMs }),
      fetchImpl: (async () =>
        new Response(`{"data":{"getTokenPrices":[${row}]}}`)),
    })();

    expect(result[0]?.status).toBe(status);
    expect(result[0]?.unitPrice).toEqual(
      status === "fresh" ? { atoms: "1", scale: 0 } : null,
    );
  });

  test("marks duplicate exact-contract records unavailable rather than choosing one", async () => {
    const stale = String(Number(NOW_SECONDS) - 301);
    const row = `{"address":"${ADDRESS}","networkId":8453,"priceUsd":1,"timestamp":${stale}}`;
    const duplicate = await createCodexRawQuotesReader({
      apiKey: "fixture-key",
      inputs: [input],
      now: () => new Date(NOW),
      fetchImpl: (async () =>
        new Response(`{"data":{"getTokenPrices":[${row},${row}]}}`)),
    })();
    expect(duplicate[0]?.status).toBe("invalid");
    expect(duplicate[0]?.unitPrice).toBeNull();
  });
});
