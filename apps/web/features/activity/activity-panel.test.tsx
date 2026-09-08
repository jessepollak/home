import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/features/account/session-types";
import type { ActivityPage, FetchActivity } from "./types";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { ActivityPanel } = await import("./activity-panel");

const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
const WALLET_B = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;

function session(
  subject: string,
  address: typeof WALLET_A | typeof WALLET_B,
  accountProvider: VerifiedAccountSession["accountProvider"] = "cdp-embedded",
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  };
}

function pageFor(
  query: string,
  walletAddress: typeof WALLET_A | typeof WALLET_B,
  options: {
    id?: string;
    blockNumber?: string;
    amount?: string;
    direction?: "incoming" | "outgoing" | "self";
    nextCursor?: string | null;
    empty?: boolean;
  } = {},
): ActivityPage {
  const parameters = new URLSearchParams(query);
  const to = parameters.get("to")!;
  const toTime = new Date(to).getTime();
  const from = new Date(toTime - 31 * 24 * 60 * 60 * 1000).toISOString();
  const direction = options.direction ?? "incoming";
  const fromAddress = direction === "incoming" ? OTHER : walletAddress;
  const toAddress = direction === "outgoing" ? OTHER : walletAddress;
  return {
    walletAddress,
    chainId: 8453,
    window: { from, to },
    transfers: options.empty
      ? []
      : [
          {
            id: options.id ?? "event-1",
            chainId: 8453,
            assetId: "usdc",
            tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            walletAddress,
            fromAddress,
            toAddress,
            direction,
            amountBaseUnits: options.amount ?? "1000001",
            blockNumber: options.blockNumber ?? "20",
            blockHash: `0x${"a".repeat(64)}`,
            transactionHash: `0x${(options.id === "event-2" ? "b" : "a").repeat(64)}`,
            logIndex: "1",
            blockTimestamp: new Date(toTime - 60_000).toISOString(),
          },
        ],
    nextCursor: options.nextCursor ?? null,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: new Date(toTime - 30_000).toISOString(),
      executionTimeMs: 2,
      fetchedAt: to,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => cleanup());

describe("ActivityPanel", () => {
  test("renders direction, bounded shared amount formatting, freshness, and explorer link", async () => {
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={async (query) =>
          pageFor(query, WALLET_A, { amount: "1234567890000" })
        }
      />,
    );

    await waitFor(() => expect(view.getByText("Received")).toBeTruthy());
    expect(view.getByText("+1,234,567.89 USDC")).toBeTruthy();
    expect(view.getByText(/Updated/)).toBeTruthy();
    const explorer = view.getByRole("link", { name: /View received USDC/ });
    expect(explorer.getAttribute("href")).toBe(
      `https://basescan.org/tx/0x${"a".repeat(64)}`,
    );
    expect(view.queryByText("Activity coverage")).toBeNull();
  });

  test("renders Base Account session transfers the same as email CDP", async () => {
    const view = render(
      <ActivityPanel
        session={session("siwe-subject", WALLET_A, "base-account")}
        fetchActivity={async (query) =>
          pageFor(query, WALLET_A, { amount: "10000000" })
        }
      />,
    );

    await waitFor(() => expect(view.getByText("Received")).toBeTruthy());
    expect(view.getByText("+10 USDC")).toBeTruthy();
  });

  test("keeps the pagination window and first-page freshness stable while deduplicating overlap", async () => {
    const queries: string[] = [];
    let initialExecutionTimestamp = "";
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        const first = pageFor(query, WALLET_A, {
          id: "event-1",
          blockNumber: "20",
          nextCursor: "cursor-1",
        });
        initialExecutionTimestamp = new Date(
          new Date(first.window.to).getTime() - 60 * 60 * 1000,
        ).toISOString();
        first.source.stale = true;
        first.source.executionTimestamp = initialExecutionTimestamp;
        return first;
      }
      const second = pageFor(query, WALLET_A, {
        id: "event-2",
        blockNumber: "19",
      });
      second.source.stale = false;
      second.source.executionTimestamp = new Date(
        new Date(second.window.to).getTime() - 1_000,
      ).toISOString();
      second.transfers.unshift({
        ...pageFor(query, WALLET_A, {
          id: "event-1",
          blockNumber: "20",
        }).transfers[0]!,
      });
      return second;
    };
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={fetchActivity}
      />,
    );

    await waitFor(() => expect(view.getByText("Load more")).toBeTruthy());
    expect(view.getByText(/Data may be delayed/)).toBeTruthy();
    fireEvent.click(view.getByText("Load more"));
    await waitFor(() => expect(queries).toHaveLength(2));
    await waitFor(() =>
      expect(view.getAllByRole("link", { name: /transfer on BaseScan/ })).toHaveLength(2),
    );
    const firstQuery = new URLSearchParams(queries[0]);
    const secondQuery = new URLSearchParams(queries[1]);
    expect(secondQuery.get("to")).toBe(firstQuery.get("to"));
    expect(secondQuery.get("cursor")).toBe("cursor-1");
    expect(view.getByText(/Data may be delayed/)).toBeTruthy();
    expect(
      view.getByRole("status").querySelector("time")?.getAttribute("datetime"),
    ).toBe(initialExecutionTimestamp);
  });

  test("clears immediately on account switch, aborts the old request, and ignores its late response", async () => {
    const pendingA = deferred<unknown>();
    const pendingB = deferred<unknown>();
    const signals: AbortSignal[] = [];
    const queries: string[] = [];
    let calls = 0;
    const fetchActivity: FetchActivity = (query, signal) => {
      queries.push(query);
      signals.push(signal!);
      calls += 1;
      return calls === 1 ? pendingA.promise : pendingB.promise;
    };
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={fetchActivity}
      />,
    );
    await waitFor(() => expect(calls).toBe(1));

    view.rerender(
      <ActivityPanel
        session={session("subject-b", WALLET_B)}
        fetchActivity={fetchActivity}
      />,
    );
    expect(view.getByText("Loading recent activity…")).toBeTruthy();
    await waitFor(() => expect(calls).toBe(2));
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      pendingB.resolve(pageFor(queries[1]!, WALLET_B, { id: "event-2" }));
      await pendingB.promise;
    });
    expect(view.getByText("Received")).toBeTruthy();

    await act(async () => {
      pendingA.resolve(pageFor(queries[0]!, WALLET_A));
      await pendingA.promise;
    });
    expect(view.getAllByText("Received")).toHaveLength(1);
  });

  test("shows empty, error/retry, and sign-out states without inventing activity", async () => {
    let calls = 0;
    const fetchActivity: FetchActivity = async (query) => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return pageFor(query, WALLET_A, { empty: true });
    };
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={fetchActivity}
      />,
    );
    await waitFor(() =>
      expect(view.getByText("Activity is temporarily unavailable.")).toBeTruthy(),
    );
    expect(view.queryByText("No transfer history was inferred from this error.")).toBeNull();
    fireEvent.click(view.getByText("Try again"));
    await waitFor(() =>
      expect(view.getByText("No activity yet")).toBeTruthy(),
    );

    view.rerender(
      <ActivityPanel session={null} fetchActivity={fetchActivity} />,
    );
    expect(view.getByText("No activity yet")).toBeTruthy();
  });

  test("surfaces the safe server activity error code and message", async () => {
    const failure = new Error("Authenticated resource is unavailable.");
    Object.assign(failure, {
      status: 504,
      code: "ACTIVITY_TIMEOUT",
      serverMessage: "Recent Base activity timed out. Try again.",
    });
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={async () => {
          throw failure;
        }}
      />,
    );
    await waitFor(() =>
      expect(view.getByText("Activity is temporarily unavailable.")).toBeTruthy(),
    );
    expect(view.getByText("Recent Base activity timed out. Try again.")).toBeTruthy();
    expect(view.queryByText("No transfer history was inferred from this error.")).toBeNull();
  });
});
