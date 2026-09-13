import { describe, expect, test } from "bun:test";
import type { PriceQuote } from "@/shared/portfolio/valuation-types";
import { createBalancesPricer } from "./price";
import type { BalancesRead, ReadHolding } from "./types";

const source = { provider: "Codex" as const, method: "test", fetchedAt: "2026-09-13T12:00:00.000Z", asOf: "2026-09-13T11:59:00.000Z", timeBasis: "provider-as-of" as const };
function holding(address: string, id: string, sourceKind: "registry" | "catalog", options: { cash?: "USD"; liquidity?: string; volume?: string } = {}): ReadHolding {
  return {
    key: `eip155:8453/erc20:${address}`, id, kind: "erc20", source: sourceKind, name: id, symbol: id.toUpperCase(), decimals: 6,
    contractAddress: address as `0x${string}`, cashCurrency: options.cash ?? null, balance: { status: "ready", baseUnits: "1000000" },
    ...(sourceKind === "catalog" ? { liquidityUsd: { atoms: options.liquidity ?? "100000", scale: 0 }, volume24Usd: { atoms: options.volume ?? "10000", scale: 0 } } : {}),
  };
}
const usdc = holding("0x1111111111111111111111111111111111111111", "usdc", "registry", { cash: "USD" });
const dust = holding("0x2222222222222222222222222222222222222222", "catalog:dust", "catalog", { liquidity: "99999" });
const stale = holding("0x3333333333333333333333333333333333333333", "catalog:stale", "catalog");
const read: BalancesRead = { block: { number: "1", hash: `0x${"1".repeat(64)}`, timestamp: "1" }, holdings: [usdc, dust, stale], coverage: { registry: "complete", catalog: "complete" } };
function quote(assetKey: string, status: PriceQuote["status"]): PriceQuote {
  return { assetKey: assetKey as PriceQuote["assetKey"], contractAddress: assetKey.split(":").at(-1) as `0x${string}`, quoteCurrency: "USD", unitPrice: status === "fresh" ? { atoms: "1", scale: 0 } : null, sourceValue: "1", status, source };
}
function rates(includeEur = true) {
  return {
    fetchedAt: source.fetchedAt,
    quotes: [
      { baseCurrency: "USD", quoteCurrency: "USD", quoteUnitsPerUsd: { atoms: "1", scale: 0 }, sourceValue: "1", status: "fresh", source },
      ...(includeEur ? [{ baseCurrency: "USD" as const, quoteCurrency: "EUR" as const, quoteUnitsPerUsd: { atoms: "9", scale: 1 }, sourceValue: "0.9", status: "fresh" as const, source }] : []),
    ],
    nativeEthQuote: { baseCurrency: "USD", assetSymbol: "ETH", assetUnitsPerUsd: { atoms: "1", scale: 3 }, sourceValue: "0.001", status: "fresh", source },
  } as never;
}

describe("balances pricing", () => {
  test("applies the catalog gate, stale reason, and cash denomination", async () => {
    const price = createBalancesPricer({
      readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, input.assetKey === stale.key ? "stale" : "fresh")),
      readExchangeRates: async () => rates(),
    });
    const result = await price(read, "DE");
    expect(result.find(({ id }) => id === dust.id)?.value).toEqual({ status: "unpriced", reason: "below-market-gate" });
    expect(result.find(({ id }) => id === stale.id)?.value).toEqual({ status: "unpriced", reason: "price-stale" });
    expect(result.find(({ id }) => id === "usdc")?.cashValue).toMatchObject({ status: "priced", currency: "USD" });
    expect(result.find(({ id }) => id === "usdc")?.value).toMatchObject({ status: "priced", currency: "EUR" });
  });

  test("reports missing regional FX without losing own-currency cash value", async () => {
    const price = createBalancesPricer({ readPrices: async (inputs) => inputs.map((input) => quote(input.assetKey, "fresh")), readExchangeRates: async () => rates(false) });
    const result = await price({ ...read, holdings: [usdc] }, "DE");
    expect(result[0]?.value).toEqual({ status: "unpriced", reason: "fx-unavailable" });
    expect(result[0]?.cashValue).toMatchObject({ status: "priced", currency: "USD" });
  });
});
