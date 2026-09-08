import { describe, expect, test } from "bun:test";
import type { PortfolioValuationSnapshot } from "@/server/valuation/types";
import { presentPortfolioValuation } from "./present-home-balances";

function snapshot(
  overrides: Partial<PortfolioValuationSnapshot> = {},
): PortfolioValuationSnapshot {
  return {
    version: 2,
    walletAddress: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
    selectedRegion: "BR",
    quoteCurrency: "BRL",
    block: { number: "16", hash: `0x${"ab".repeat(32)}`, timestamp: "100" },
    fetchedAt: "2026-09-08T12:00:00.000Z",
    inventory: {
      scope: "configured-base-assets-v1",
      walletDiscoveryComplete: false,
      holdings: [],
      omissions: [],
    },
    prices: [],
    fx: null,
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: { atoms: "5", scale: 4 },
      sourceValue: "0.0005",
      status: "fresh",
      source: {
        provider: "Coinbase Exchange Rates",
        method: "fixture",
        fetchedAt: "2026-09-08T12:00:00.000Z",
        asOf: null,
        timeBasis: "retrieved-at",
      },
    },
    lines: [],
    cashBuckets: [
      {
        id: "cash:usd",
        roles: ["canonical-usd"],
        assetKey: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        symbol: "USDC",
        denominationCurrency: "USD",
        tokenAmountBaseUnits: "0",
        tokenDecimals: 6,
        indicativeValue: { atoms: "0", scale: 6 },
        valuationStatus: "priced",
      },
      {
        id: "cash:brl",
        roles: ["selected-local"],
        assetKey: null,
        symbol: "BRZ",
        denominationCurrency: "BRL",
        tokenAmountBaseUnits: null,
        tokenDecimals: null,
        indicativeValue: null,
        valuationStatus: "unsupported",
      },
    ],
    total: {
      label: "supported-portfolio-value",
      status: "all-supported-read-holdings-priced",
      value: { atoms: "0", scale: 6 },
      currency: "BRL",
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    },
    ...overrides,
  };
}

describe("presentPortfolioValuation", () => {
  test("uses a quiet loading label and no valuation sentence", () => {
    const presented = presentPortfolioValuation({
      status: "loading",
      snapshot: null,
      error: null,
    });
    expect(presented.statusLabel).toBe("Updating…");
    expect(presented.displayTotal).toBeNull();
  });

  test("labels cash with currency names and honest zeros, not stablecoin pairs", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot(),
      error: null,
    });

    expect(presented.displayTotal).toBe("R$ 0,00");
    expect(presented.statusLabel).toBeUndefined();
    expect(presented.items.map((item) => item.name)).toEqual([
      "US dollar",
      "Brazilian real",
    ]);
    expect(presented.items.map((item) => item.displayBalance)).toEqual([
      "$0.00",
      "R$ 0,00",
    ]);
    expect(presented.items.every((item) => item.group === "cash")).toBe(true);
    const serialized = JSON.stringify(presented);
    expect(serialized).not.toContain("USDC");
    expect(serialized).not.toContain("BRZ");
    expect(serialized).not.toContain("USD /");
    expect(serialized).not.toContain("BRL /");
    expect(serialized).not.toContain("Not available yet");
    expect(serialized).not.toContain("Wallet & savings");
    expect(serialized).not.toContain("Unavailable");
  });

  test("keeps unpriced cash visibly unpriced instead of treating token units as fiat", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        cashBuckets: [
          {
            id: "cash:usd",
            roles: ["canonical-usd"],
            assetKey: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            symbol: "USDC",
            denominationCurrency: "USD",
            tokenAmountBaseUnits: "100000000",
            tokenDecimals: 6,
            indicativeValue: null,
            valuationStatus: "unpriced",
          },
          {
            id: "cash:eur",
            roles: ["selected-local"],
            assetKey: "eip155:8453/erc20:0x60a3e35cc302bfa44cb288bc5a4f316e2f531371",
            symbol: "EURC",
            denominationCurrency: "EUR",
            tokenAmountBaseUnits: "25000000",
            tokenDecimals: 6,
            indicativeValue: null,
            valuationStatus: "unpriced",
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.map((item) => item.displayBalance)).toEqual([
      "—",
      "—",
    ]);
    expect(presented.items.every((item) => item.tone === "muted")).toBe(true);
    const serialized = JSON.stringify(presented);
    expect(serialized).not.toContain("$100");
    expect(serialized).not.toContain("€25");
    expect(serialized).not.toContain("100.00");
    expect(serialized).not.toContain("25.00");
  });

  test("marks a failed cash read as unavailable without inventing a fiat amount", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        cashBuckets: [
          {
            id: "cash:usd",
            roles: ["canonical-usd"],
            assetKey: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            symbol: "USDC",
            denominationCurrency: "USD",
            tokenAmountBaseUnits: null,
            tokenDecimals: 6,
            indicativeValue: null,
            valuationStatus: "read-unavailable",
          },
        ],
      }),
      error: null,
    });

    expect(presented.items).toEqual([
      {
        id: "cash:usd",
        group: "cash",
        name: "US dollar",
        displayBalance: "Unavailable",
        currencyCode: "USD",
        tone: "error",
      },
    ]);
  });
});
