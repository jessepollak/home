import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { usePortfolioValuation } from "./use-portfolio-valuation";
import type { FetchPortfolioValuation } from "@/shared/portfolio/valuation-state";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const session = {
  subject: "subject-a",
  smartAccountAddress: ADDRESS,
  chainId: 8453 as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function snapshot(region: "US" | "DE") {
  const currency = region === "US" ? "USD" : "EUR";
  const source = {
    provider: "Coinbase Exchange Rates",
    method: "fixture",
    fetchedAt: "2026-09-08T12:00:00.000Z",
    asOf: null,
    timeBasis: "retrieved-at",
  };
  const usdcKey =
    "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const holdings = [
    {
      kind: "direct",
      id: "eth",
      assetKey: "eip155:8453/native",
      name: "Ethereum",
      symbol: "ETH",
      decimals: 18,
      assetKind: "native",
      contractAddress: null,
      cashCurrency: null,
      balanceBaseUnits: "0",
      readStatus: "ready",
    },
    {
      kind: "direct",
      id: "usdc",
      assetKey: usdcKey,
      name: "US dollar",
      symbol: "USDC",
      decimals: 6,
      assetKind: "erc20",
      contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      cashCurrency: "USD",
      balanceBaseUnits: "1000000",
      readStatus: "ready",
    },
    ...[
      "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61",
      "0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a",
      "0xbeef010f9cb27031ad51e3333f9af9c6b1228183",
    ].map((address, index) => ({
      kind: "vault-position",
      id: `vault-${index}`,
      assetKey: `eip155:8453/erc20:${address}`,
      name: `Vault ${index}`,
      symbol: "USDC vault",
      vaultAddress: address,
      decimals: 18,
      underlyingAssetKey: usdcKey,
      underlyingSymbol: "USDC",
      underlyingDecimals: 6,
      sharesBaseUnits: "0",
      underlyingBaseUnits: "0",
      readStatus: "ready",
      conversionMethod: "erc4626-convertToAssets",
    })),
  ];
  return {
    version: 2,
    walletAddress: ADDRESS,
    chainId: 8453,
    selectedRegion: region,
    quoteCurrency: currency,
    block: { number: "16", hash: `0x${"ab".repeat(32)}`, timestamp: "100" },
    fetchedAt: "2026-09-08T12:00:00.000Z",
    inventory: {
      scope: "configured-base-assets-v1",
      walletDiscoveryComplete: false,
      holdings,
      omissions: [],
    },
    prices: [],
    fx: {
      baseCurrency: "USD",
      quoteCurrency: currency,
      quoteUnitsPerUsd: { atoms: "1", scale: 0 },
      sourceValue: "1",
      status: "fresh",
      source,
    },
    nativeEthQuote: {
      baseCurrency: "USD",
      assetSymbol: "ETH",
      assetUnitsPerUsd: { atoms: "5", scale: 4 },
      sourceValue: "0.0005",
      status: "fresh",
      source,
    },
    lines: holdings.map((holding) => ({
      holdingAssetKey: holding.assetKey,
      valueCurrency: currency,
      value: { atoms: "0", scale: 18 },
      status: "priced",
      reason: null,
    })),
    cashBuckets: [
      {
        id: `cash:${usdcKey}`,
        roles:
          region === "US"
            ? ["canonical-usd", "selected-local"]
            : ["canonical-usd"],
        assetKey: usdcKey,
        symbol: "USDC",
        denominationCurrency: "USD",
        tokenAmountBaseUnits: "1000000",
        tokenDecimals: 6,
        indicativeValue: { atoms: "1", scale: 0 },
        valuationStatus: "priced",
      },
    ],
    total: {
      label: "supported-portfolio-value",
      status: "all-supported-read-holdings-priced",
      value: { atoms: region === "US" ? "1" : "9", scale: region === "US" ? 0 : 1 },
      currency,
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    },
  };
}

function Harness({ region, fetchValuation }: { region: "US" | "DE"; fetchValuation: FetchPortfolioValuation }) {
  const state = usePortfolioValuation(session, region, fetchValuation);
  return <div>{state.status === "ready" ? `${state.snapshot.selectedRegion}:${state.snapshot.quoteCurrency}` : state.status}</div>;
}

afterEach(cleanup);

describe("portfolio valuation ownership", () => {
  test("clears prior currency data and ignores a late response after region changes", async () => {
    const us = deferred<unknown>();
    const de = deferred<unknown>();
    const fetchValuation: FetchPortfolioValuation = (region) =>
      region === "US" ? us.promise : de.promise;
    const view = render(<Harness region="US" fetchValuation={fetchValuation} />);

    view.rerender(<Harness region="DE" fetchValuation={fetchValuation} />);
    expect(document.body.textContent).toBe("loading");

    await act(async () => us.resolve(snapshot("US")));
    expect(document.body.textContent).toBe("loading");
    await act(async () => de.resolve(snapshot("DE")));
    await waitFor(() => expect(document.body.textContent).toBe("DE:EUR"));
  });
});
