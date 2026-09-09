import { describe, expect, test } from "bun:test";
import {
  PORTFOLIO_NATIVE_ASSET_KEY,
  PORTFOLIO_USDC_ASSET_KEY,
  nativeEthAsset,
  verifiedLocalCashAssets,
} from "@/config/portfolio-assets";
import type {
  DirectPortfolioHolding,
  PortfolioValuationSnapshot,
} from "@/server/valuation/types";
import { presentPortfolioValuation } from "./present-home-balances";

function directHolding(
  overrides: Partial<DirectPortfolioHolding> &
    Pick<DirectPortfolioHolding, "id" | "assetKey" | "name" | "symbol">,
): DirectPortfolioHolding {
  return {
    kind: "direct",
    decimals: 18,
    assetKind: "native",
    contractAddress: null,
    cashCurrency: null,
    balanceBaseUnits: "0",
    readStatus: "ready",
    ...overrides,
  };
}

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

  test("emits nonzero ETH as an asset row without inventing a fiat amount", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "50000000000000000",
            }),
          ],
          omissions: [],
        },
      }),
      error: null,
    });

    expect(presented.items.filter((item) => item.group === "cash")).toHaveLength(2);
    expect(presented.items.filter((item) => item.group === "asset")).toEqual([
      {
        id: `asset:${PORTFOLIO_NATIVE_ASSET_KEY}`,
        group: "asset",
        name: "Ethereum",
        detail: "ETH",
        displayBalance: "0.0500 ETH",
        currencyCode: null,
      },
    ]);
    expect(JSON.stringify(presented.items)).not.toContain("USDC");
    expect(
      JSON.stringify(presented.items.filter((item) => item.group === "asset")),
    ).not.toContain("$");
  });

  test("keeps native primary when a priced line is a placeholder zero", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "50000000000000000",
            }),
          ],
          omissions: [],
        },
        lines: [
          {
            holdingAssetKey: PORTFOLIO_NATIVE_ASSET_KEY,
            valueCurrency: "BRL",
            value: { atoms: "0", scale: 18 },
            status: "priced",
            reason: null,
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.find((item) => item.group === "asset")).toMatchObject({
      displayBalance: "0.0500 ETH",
    });
    expect(presented.items.find((item) => item.group === "asset")?.displayContext).toBeUndefined();
  });

  test("uses fiat primary and bounded native secondary when ETH is priced", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "US",
        quoteCurrency: "USD",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "1101012331497033445",
            }),
          ],
          omissions: [],
        },
        lines: [
          {
            holdingAssetKey: PORTFOLIO_NATIVE_ASSET_KEY,
            valueCurrency: "USD",
            value: { atoms: "481240", scale: 2 },
            status: "priced",
            reason: null,
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.find((item) => item.group === "asset")).toEqual({
      id: `asset:${PORTFOLIO_NATIVE_ASSET_KEY}`,
      group: "asset",
      name: "Ethereum",
      detail: "ETH",
      displayBalance: "$4,812.40",
      displayContext: "1.1010 ETH",
      currencyCode: null,
    });
    expect(JSON.stringify(presented.items)).not.toContain("1.101012331497033445");
  });

  test("uses local fiat primary when priced ETH is quoted in IDR", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "ID",
        quoteCurrency: "IDR",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "1101012331497033445",
            }),
          ],
          omissions: [],
        },
        lines: [
          {
            holdingAssetKey: PORTFOLIO_NATIVE_ASSET_KEY,
            valueCurrency: "IDR",
            value: { atoms: "78123456", scale: 0 },
            status: "priced",
            reason: null,
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.find((item) => item.group === "asset")).toEqual({
      id: `asset:${PORTFOLIO_NATIVE_ASSET_KEY}`,
      group: "asset",
      name: "Ethereum",
      detail: "ETH",
      displayBalance: "Rp 78,123,456.00",
      displayContext: "1.1010 ETH",
      currencyCode: null,
    });
    expect(JSON.stringify(presented.items.find((item) => item.group === "asset"))).not.toContain(
      "$",
    );
  });

  test("bounds unpriced ETH and dust instead of rendering eighteen fractional digits", () => {
    const wrap = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "1101012331497033445",
            }),
          ],
          omissions: [],
        },
      }),
      error: null,
    });
    const dust = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "US",
        quoteCurrency: "USD",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "1",
            }),
          ],
          omissions: [],
        },
        lines: [
          {
            holdingAssetKey: PORTFOLIO_NATIVE_ASSET_KEY,
            valueCurrency: "USD",
            value: { atoms: "4", scale: 3 },
            status: "priced",
            reason: null,
          },
        ],
      }),
      error: null,
    });

    expect(wrap.items.find((item) => item.group === "asset")).toMatchObject({
      displayBalance: "1.1010 ETH",
    });
    expect(JSON.stringify(wrap.items)).not.toContain("1.101012331497033445");
    expect(dust.items.find((item) => item.group === "asset")).toEqual({
      id: `asset:${PORTFOLIO_NATIVE_ASSET_KEY}`,
      group: "asset",
      name: "Ethereum",
      detail: "ETH",
      displayBalance: "<$0.01",
      displayContext: "<0.000001 ETH",
      currencyCode: null,
    });
  });

  test("omits zero ETH and keeps selected local cash out of the asset list", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "ID",
        quoteCurrency: "IDR",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
            }),
            directHolding({
              id: verifiedLocalCashAssets.IDR.id,
              assetKey: verifiedLocalCashAssets.IDR.assetKey,
              name: verifiedLocalCashAssets.IDR.name,
              symbol: verifiedLocalCashAssets.IDR.symbol,
              decimals: verifiedLocalCashAssets.IDR.decimals,
              assetKind: "erc20",
              contractAddress: verifiedLocalCashAssets.IDR.contractAddress,
              cashCurrency: "IDR",
              balanceBaseUnits: "250000",
            }),
          ],
          omissions: [],
        },
        cashBuckets: [
          {
            id: "cash:usd",
            roles: ["canonical-usd"],
            assetKey: PORTFOLIO_USDC_ASSET_KEY,
            symbol: "USDC",
            denominationCurrency: "USD",
            tokenAmountBaseUnits: "0",
            tokenDecimals: 6,
            indicativeValue: { atoms: "0", scale: 6 },
            valuationStatus: "priced",
          },
          {
            id: `cash:${verifiedLocalCashAssets.IDR.assetKey}`,
            roles: ["selected-local"],
            assetKey: verifiedLocalCashAssets.IDR.assetKey,
            symbol: "IDRX",
            denominationCurrency: "IDR",
            tokenAmountBaseUnits: "250000",
            tokenDecimals: 2,
            indicativeValue: { atoms: "250000", scale: 2 },
            valuationStatus: "priced",
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.map((item) => item.group)).toEqual(["cash", "cash"]);
    expect(presented.items.map((item) => item.name)).toEqual([
      "US dollar",
      "Indonesian rupiah",
    ]);
  });

  test("surfaces funded nonselected local cash as an asset row", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "US",
        quoteCurrency: "USD",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: verifiedLocalCashAssets.IDR.id,
              assetKey: verifiedLocalCashAssets.IDR.assetKey,
              name: verifiedLocalCashAssets.IDR.name,
              symbol: verifiedLocalCashAssets.IDR.symbol,
              decimals: verifiedLocalCashAssets.IDR.decimals,
              assetKind: "erc20",
              contractAddress: verifiedLocalCashAssets.IDR.contractAddress,
              cashCurrency: "IDR",
              balanceBaseUnits: "10000",
            }),
            directHolding({
              id: verifiedLocalCashAssets.EUR.id,
              assetKey: verifiedLocalCashAssets.EUR.assetKey,
              name: verifiedLocalCashAssets.EUR.name,
              symbol: verifiedLocalCashAssets.EUR.symbol,
              decimals: verifiedLocalCashAssets.EUR.decimals,
              assetKind: "erc20",
              contractAddress: verifiedLocalCashAssets.EUR.contractAddress,
              cashCurrency: "EUR",
              balanceBaseUnits: "0",
            }),
          ],
          omissions: [],
        },
        cashBuckets: [
          {
            id: "cash:usd",
            roles: ["canonical-usd", "selected-local"],
            assetKey: PORTFOLIO_USDC_ASSET_KEY,
            symbol: "USDC",
            denominationCurrency: "USD",
            tokenAmountBaseUnits: "10000000",
            tokenDecimals: 6,
            indicativeValue: { atoms: "10000000", scale: 6 },
            valuationStatus: "priced",
          },
        ],
      }),
      error: null,
    });

    expect(presented.items.map((item) => [item.group, item.name, item.displayBalance])).toEqual([
      ["cash", "US dollar", "$10.00"],
      ["asset", "Indonesian rupiah", "100.00 IDRX"],
    ]);
  });

  test("keeps cash rows in native denomination when the quote currency is IDR", () => {
    const presented = presentPortfolioValuation({
      status: "ready",
      snapshot: snapshot({
        selectedRegion: "ID",
        quoteCurrency: "IDR",
        inventory: {
          scope: "configured-base-assets-v1",
          walletDiscoveryComplete: false,
          holdings: [
            directHolding({
              id: nativeEthAsset.id,
              assetKey: PORTFOLIO_NATIVE_ASSET_KEY,
              name: nativeEthAsset.name,
              symbol: nativeEthAsset.symbol,
              balanceBaseUnits: "1101012331497033445",
            }),
          ],
          omissions: [],
        },
        lines: [
          {
            holdingAssetKey: PORTFOLIO_NATIVE_ASSET_KEY,
            valueCurrency: "IDR",
            value: { atoms: "78123456", scale: 0 },
            status: "priced",
            reason: null,
          },
        ],
        cashBuckets: [
          {
            id: "cash:usd",
            roles: ["canonical-usd"],
            assetKey: PORTFOLIO_USDC_ASSET_KEY,
            symbol: "USDC",
            denominationCurrency: "USD",
            tokenAmountBaseUnits: "10000000",
            tokenDecimals: 6,
            indicativeValue: { atoms: "10000000", scale: 6 },
            valuationStatus: "priced",
          },
          {
            id: `cash:${verifiedLocalCashAssets.IDR.assetKey}`,
            roles: ["selected-local"],
            assetKey: verifiedLocalCashAssets.IDR.assetKey,
            symbol: "IDRX",
            denominationCurrency: "IDR",
            tokenAmountBaseUnits: "250000",
            tokenDecimals: 2,
            indicativeValue: { atoms: "250000", scale: 2 },
            valuationStatus: "priced",
          },
        ],
      }),
      error: null,
    });

    expect(
      presented.items.map((item) => [item.group, item.name, item.displayBalance]),
    ).toEqual([
      ["cash", "US dollar", "$10.00"],
      ["cash", "Indonesian rupiah", "Rp 2,500.00"],
      ["asset", "Ethereum", "Rp 78,123,456.00"],
    ]);
    expect(presented.items.find((item) => item.name === "US dollar")?.displayBalance).not.toContain(
      "Rp",
    );
    expect(presented.items.find((item) => item.group === "asset")?.displayContext).toBe(
      "1.1010 ETH",
    );
  });
});
