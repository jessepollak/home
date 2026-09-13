import { describe, expect, test } from "bun:test";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import type { PriceQuote } from "@/shared/portfolio/valuation-types";
import {
  RECOGNIZED_PRICE_CANDIDATE_LIMIT,
  createRecognizedPortfolioReader,
  passesMarketQualityGate,
} from "./recognized";

const OWNER = "0x9999999999999999999999999999999999999999" as const;
const NOW = "2026-09-12T12:00:00.000Z";

function entry(index: number, liquidity = "100000", volume24 = "10000"): RecognizedTokenCatalogEntry {
  return {
    address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    decimals: 18,
    liquidityUsd: { atoms: liquidity, scale: 0 },
    volume24Usd: { atoms: volume24, scale: 0 },
  };
}

function quote(input: { assetKey: `eip155:8453/erc20:${string}`; address: `0x${string}` }): PriceQuote {
  return {
    assetKey: input.assetKey,
    contractAddress: input.address,
    quoteCurrency: "USD",
    unitPrice: { atoms: "2", scale: 0 },
    sourceValue: "2",
    status: "fresh",
    source: { provider: "Codex", method: "fixture", fetchedAt: NOW, asOf: NOW, timeBasis: "provider-as-of" },
  };
}

describe("recognized token quality and pricing", () => {
  test("applies both exact market thresholds without floating-point comparisons", () => {
    for (const [liquidity, volume, expected] of [
      [{ atoms: "100000", scale: 0 }, { atoms: "10000", scale: 0 }, true],
      [{ atoms: "9999999", scale: 2 }, { atoms: "10000", scale: 0 }, false],
      [{ atoms: "100000", scale: 0 }, { atoms: "999999", scale: 2 }, false],
      [{ atoms: "1", scale: 0 }, { atoms: "999999999", scale: 0 }, false],
    ] as const) {
      expect(passesMarketQualityGate({ liquidityUsd: liquidity, volume24Usd: volume })).toBe(expected);
    }
  });

  test("returns the optional section incomplete when its whole-branch deadline wins", async () => {
    const candidate = entry(0);
    const read = createRecognizedPortfolioReader({
      timeoutMs: 1,
      readCatalog: async () => ({ status: "complete", entries: [candidate] }),
      readBalances: async () => ({
        status: "complete",
        holdings: [{ ...candidate, balanceBaseUnits: "1" }],
      }),
      readPrices: () => new Promise<PriceQuote[]>(() => {}),
    });

    await expect(read(OWNER)).resolves.toEqual({ status: "incomplete", holdings: [] });
  });

  test("prices only quality-gated positive holdings, in 25-token batches capped at 128", async () => {
    const catalog = Array.from({ length: 132 }, (_, index) =>
      index === 0 ? entry(index, "99999", "10000") : entry(index),
    );
    const batches: string[][] = [];
    const read = createRecognizedPortfolioReader({
      readCatalog: async () => ({ status: "complete", entries: catalog }),
      readBalances: async (entries) => ({
        status: "complete",
        holdings: entries.map((candidate) => ({ ...candidate, balanceBaseUnits: "1" })),
      }),
      readPrices: async (inputs) => {
        batches.push(inputs.map(({ assetKey }) => assetKey));
        return inputs.map(quote);
      },
    });

    const result = await read(OWNER);
    const priced = result.holdings.filter(({ price }) => price !== null);

    expect(batches.map((batch) => batch.length)).toEqual([25, 25, 25, 25, 25, 3]);
    expect(priced).toHaveLength(RECOGNIZED_PRICE_CANDIDATE_LIMIT);
    expect(result.holdings[0]?.price).toBeNull();
    expect(priced[0]?.address).toBe(catalog[1]?.address);
    expect(result.holdings.at(-1)?.price).toBeNull();
  });
});
