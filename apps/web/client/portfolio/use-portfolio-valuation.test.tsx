import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { usePortfolioValuation } from "./use-portfolio-valuation";
import type { FetchPortfolioValuation } from "@/shared/portfolio/valuation-state";

const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ADDRESS_B = "0x2222222222222222222222222222222222222222" as const;
const sessionA = {
  subject: "subject-a",
  smartAccountAddress: ADDRESS,
  chainId: 8453 as const,
};
const sessionB = {
  subject: "subject-b",
  smartAccountAddress: ADDRESS_B,
  chainId: 8453 as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(
  region: "US" | "DE",
  options: {
    address?: typeof ADDRESS | typeof ADDRESS_B;
    totalAtoms?: string;
  } = {},
) {
  const address = options.address ?? ADDRESS;
  const totalAtoms = options.totalAtoms ?? "1";
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
    walletAddress: address,
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
      value: { atoms: totalAtoms, scale: 0 },
      currency,
      unpricedAssetKeys: [],
      unavailableAssetKeys: [],
    },
  };
}

function Harness({
  region,
  fetchValuation,
  refreshTrigger,
  session = sessionA,
}: {
  region: "US" | "DE";
  fetchValuation: FetchPortfolioValuation;
  refreshTrigger?: number;
  session?: typeof sessionA | typeof sessionB;
}) {
  const state = usePortfolioValuation(
    session,
    region,
    fetchValuation,
    refreshTrigger,
  );
  return (
    <div>
      {state.status === "ready"
        ? `${state.snapshot.selectedRegion}:${state.snapshot.quoteCurrency}:${state.snapshot.total.value?.atoms}`
        : state.status}
    </div>
  );
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
    await waitFor(() => expect(document.body.textContent).toBe("DE:EUR:1"));
  });

  test("same-owner refreshes read again and keep updated, unchanged, and failed results truthful", async () => {
    const reads = [
      deferred<unknown>(),
      deferred<unknown>(),
      deferred<unknown>(),
      deferred<unknown>(),
    ];
    let readIndex = 0;
    const fetchValuation: FetchPortfolioValuation = () =>
      reads[readIndex++]!.promise;
    const view = render(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={0} />,
    );

    await act(async () => reads[0]!.resolve(snapshot("US", { totalAtoms: "1" })));
    await waitFor(() => expect(document.body.textContent).toBe("US:USD:1"));

    view.rerender(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={1} />,
    );
    expect(document.body.textContent).toBe("US:USD:1");
    await act(async () => reads[1]!.resolve(snapshot("US", { totalAtoms: "2" })));
    await waitFor(() => expect(document.body.textContent).toBe("US:USD:2"));

    view.rerender(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={2} />,
    );
    expect(document.body.textContent).toBe("US:USD:2");
    await act(async () => reads[2]!.resolve(snapshot("US", { totalAtoms: "2" })));
    await waitFor(() => expect(document.body.textContent).toBe("US:USD:2"));

    view.rerender(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={3} />,
    );
    expect(document.body.textContent).toBe("US:USD:2");
    await act(async () => reads[3]!.reject(new Error("valuation unavailable")));
    await waitFor(() => expect(document.body.textContent).toBe("error"));
    expect(readIndex).toBe(4);
  });

  test("superseded refreshes are aborted and ignored across owner changes", async () => {
    const first = deferred<unknown>();
    const refreshed = deferred<unknown>();
    const nextOwner = deferred<unknown>();
    const signals: AbortSignal[] = [];
    let readIndex = 0;
    const reads = [first, refreshed, nextOwner];
    const fetchValuation: FetchPortfolioValuation = (_region, signal) => {
      if (signal) signals.push(signal);
      return reads[readIndex++]!.promise;
    };
    const view = render(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={0} />,
    );

    view.rerender(
      <Harness region="US" fetchValuation={fetchValuation} refreshTrigger={1} />,
    );
    expect(signals[0]?.aborted).toBe(true);
    view.rerender(
      <Harness
        region="US"
        fetchValuation={fetchValuation}
        refreshTrigger={1}
        session={sessionB}
      />,
    );
    expect(signals[1]?.aborted).toBe(true);

    await act(async () => {
      first.resolve(snapshot("US", { totalAtoms: "1" }));
      refreshed.resolve(snapshot("US", { totalAtoms: "2" }));
    });
    expect(document.body.textContent).toBe("loading");

    await act(async () => {
      nextOwner.resolve(snapshot("US", { address: ADDRESS_B, totalAtoms: "3" }));
    });
    await waitFor(() => expect(document.body.textContent).toBe("US:USD:3"));
    expect(readIndex).toBe(3);
  });
});
