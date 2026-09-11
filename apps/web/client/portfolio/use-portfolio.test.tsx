import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type {
  FetchPortfolio,
  PortfolioSnapshot,
  VerifiedPortfolioSession,
} from "@/shared/portfolio/types";

const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { usePortfolio } = await import("./use-portfolio");

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

function session(
  subject: string,
  address: typeof ADDRESS_A | typeof ADDRESS_B,
): VerifiedPortfolioSession {
  return { subject, smartAccountAddress: address, chainId: 8453 };
}

function snapshot(
  address: typeof ADDRESS_A | typeof ADDRESS_B,
  usdc = "7",
  eth = "42",
): PortfolioSnapshot {
  return {
    walletAddress: address,
    chainId: 8453,
    blockNumber: "16",
    blockHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: "100",
    fetchedAt: "2026-09-07T20:30:00.000Z",
    assets: [
      {
        id: "usdc",
        symbol: "USDC",
        decimals: 6,
        kind: "erc20",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        balanceBaseUnits: usdc,
      },
      {
        id: "eth",
        symbol: "ETH",
        decimals: 18,
        kind: "native",
        balanceBaseUnits: eth,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function PortfolioProbe({
  verifiedSession,
  fetchPortfolio,
  refreshTrigger,
}: {
  verifiedSession: VerifiedPortfolioSession | null;
  fetchPortfolio: FetchPortfolio;
  refreshTrigger?: string | number;
}) {
  const state = usePortfolio(verifiedSession, fetchPortfolio, refreshTrigger);
  return (
    <div>
      <output data-testid="status">{state.status}</output>
      <output data-testid="wallet">
        {state.snapshot?.walletAddress ?? "wallet-hidden"}
      </output>
      <output data-testid="usdc">
        {state.snapshot?.assets.find((asset) => asset.id === "usdc")
          ?.balanceBaseUnits ?? "balance-unknown"}
      </output>
    </div>
  );
}

afterEach(() => cleanup());

describe("usePortfolio production hook", () => {
  test("loads a controlled HTTP callback and accepts a real zero snapshot as ready", async () => {
    const seenSignals: AbortSignal[] = [];
    const fetchPortfolio: FetchPortfolio = async (signal) => {
      seenSignals.push(signal);
      return snapshot(ADDRESS_A, "0", "0");
    };

    const view = render(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={fetchPortfolio}
      />,
    );

    await waitFor(() =>
      expect(view.getByTestId("status").textContent).toBe("ready"),
    );
    expect(view.getByTestId("wallet").textContent).toBe(ADDRESS_A);
    expect(view.getByTestId("usdc").textContent).toBe("0");
    expect(seenSignals).toHaveLength(1);
  });

  test("reloads the same owner when the optional refresh trigger changes", async () => {
    let calls = 0;
    const fetchPortfolio: FetchPortfolio = async () => {
      calls += 1;
      return snapshot(ADDRESS_A, String(calls));
    };
    const view = render(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={fetchPortfolio}
        refreshTrigger={0}
      />,
    );

    await waitFor(() => expect(view.getByTestId("usdc").textContent).toBe("1"));
    view.rerender(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={fetchPortfolio}
        refreshTrigger={1}
      />,
    );

    await waitFor(() => expect(view.getByTestId("usdc").textContent).toBe("2"));
    expect(calls).toBe(2);
  });

  test("clears A immediately for B, aborts A, and ignores A's late response", async () => {
    const pendingA = deferred<unknown>();
    const pendingB = deferred<unknown>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const fetchPortfolio: FetchPortfolio = (signal) => {
      signals.push(signal);
      calls += 1;
      return calls === 1 ? pendingA.promise : pendingB.promise;
    };
    const view = render(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={fetchPortfolio}
      />,
    );

    await waitFor(() => expect(calls).toBe(1));
    view.rerender(
      <PortfolioProbe
        verifiedSession={session("subject-b", ADDRESS_B)}
        fetchPortfolio={fetchPortfolio}
      />,
    );

    expect(view.getByTestId("status").textContent).toBe("loading");
    expect(view.getByTestId("wallet").textContent).toBe("wallet-hidden");
    await waitFor(() => expect(calls).toBe(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      pendingB.resolve(snapshot(ADDRESS_B));
      await pendingB.promise;
    });
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("wallet").textContent).toBe(ADDRESS_B);

    await act(async () => {
      pendingA.resolve(snapshot(ADDRESS_A));
      await pendingA.promise;
    });
    expect(view.getByTestId("wallet").textContent).toBe(ADDRESS_B);
  });

  test("clears immediately on logout, aborts the request, and ignores its late response", async () => {
    const pending = deferred<unknown>();
    let requestSignal: AbortSignal | undefined;
    const fetchPortfolio: FetchPortfolio = (signal) => {
      requestSignal = signal;
      return pending.promise;
    };
    const view = render(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={fetchPortfolio}
      />,
    );

    await waitFor(() => expect(requestSignal).toBeDefined());
    view.rerender(
      <PortfolioProbe
        verifiedSession={null}
        fetchPortfolio={fetchPortfolio}
      />,
    );

    expect(view.getByTestId("status").textContent).toBe("unavailable");
    expect(view.getByTestId("wallet").textContent).toBe("wallet-hidden");
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));

    await act(async () => {
      pending.resolve(snapshot(ADDRESS_A));
      await pending.promise;
    });
    expect(view.getByTestId("status").textContent).toBe("unavailable");
    expect(view.getByTestId("wallet").textContent).toBe("wallet-hidden");
  });

  test("rejects a response for another wallet instead of exposing it or showing zero", async () => {
    const view = render(
      <PortfolioProbe
        verifiedSession={session("subject-a", ADDRESS_A)}
        fetchPortfolio={async () => snapshot(ADDRESS_B, "0", "0")}
      />,
    );

    await waitFor(() =>
      expect(view.getByTestId("status").textContent).toBe("error"),
    );
    expect(view.getByTestId("wallet").textContent).toBe("wallet-hidden");
    expect(view.getByTestId("usdc").textContent).toBe("balance-unknown");
  });
});
