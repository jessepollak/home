import { describe, expect, test } from "bun:test";
import type { RecognizedTokenCatalogEntry } from "@/server/market-data/codex/recognized-catalog";
import { createBalancesUniverseReader } from "./universe";

const catalog: RecognizedTokenCatalogEntry[] = [
  { address: "0x1111111111111111111111111111111111111111", name: "One", symbol: "ONE", decimals: 18, liquidityUsd: { atoms: "100000", scale: 0 }, volume24Usd: { atoms: "10000", scale: 0 } },
  { address: "0x2222222222222222222222222222222222222222", name: "Two", symbol: "TWO", decimals: 6, liquidityUsd: { atoms: "200000", scale: 0 }, volume24Usd: { atoms: "20000", scale: 0 } },
];

describe("balances universe", () => {
  test("keeps registry first in cash-first order and drops decimal mismatches", async () => {
    const read = createBalancesUniverseReader({
      hasApiKey: () => true,
      readCatalog: async () => ({ status: "complete", entries: catalog }),
      readDecimals: async () => [18, 18],
    });
    const result = await read();
    expect(result.entries.slice(0, 3).map(({ id }) => id)).toEqual(["usdc", "eurc", "idrx"]);
    expect(result.entries.findIndex(({ source }) => source === "catalog")).toBeGreaterThan(20);
    expect(result.entries.filter(({ source }) => source === "catalog").map(({ symbol }) => symbol)).toEqual(["ONE"]);
    expect(result.catalogStatus).toBe("incomplete");
  });

  test("returns registry only and unavailable coverage without a Codex key", async () => {
    let called = false;
    const read = createBalancesUniverseReader({
      hasApiKey: () => false,
      readCatalog: async () => { called = true; return { status: "complete", entries: catalog }; },
    });
    const result = await read();
    expect(called).toBe(false);
    expect(result.entries.every(({ source }) => source === "registry")).toBe(true);
    expect(result.catalogStatus).toBe("unavailable");
  });
});
