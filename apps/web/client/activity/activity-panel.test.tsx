import "../account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  type ActivityPage,
  type FetchActivity,
} from "./types";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { ActivityPanel } = await import("./activity-panel");

class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect() {
    this.target = null;
  }

  observe(target: Element) {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element) {
    if (this.target === target) this.target = null;
  }

  intersect() {
    if (!this.target) return;
    const rect = this.target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: 1,
          intersectionRect: rect,
          isIntersecting: true,
          rootBounds: null,
          target: this.target,
          time: performance.now(),
        },
      ],
      this,
    );
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

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
  const logId = options.id ?? "event-1";
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
  return {
    walletAddress,
    chainId: 8453,
    window: { from, to },
    transfers: options.empty
      ? []
      : [
          {
            id: `8453:${tokenAddress}:${logId}`,
            logId,
            chainId: 8453,
            assetId: "usdc",
            tokenAddress,
            tokenSymbol: "USDC",
            tokenDecimals: 6,
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

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
  ControlledIntersectionObserver.instances = [];
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  });
});

describe("ActivityPanel", () => {
  test("keeps the pagination window stable while deduplicating overlap", async () => {
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

    await waitFor(() => expect(view.getByText("Load more activity")).toBeTruthy());
    expect(view.queryByText(/Data may be delayed/)).toBeNull();
    expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
    fireEvent.click(view.getByText("Load more activity"));
    await waitFor(() => expect(queries).toHaveLength(2));
    await waitFor(() =>
      expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2),
    );
    const firstQuery = new URLSearchParams(queries[0]);
    const secondQuery = new URLSearchParams(queries[1]);
    expect(secondQuery.get("to")).toBe(firstQuery.get("to"));
    expect(secondQuery.get("cursor")).toBe("cursor-1");
    expect(view.queryByText(/Updated /)).toBeNull();
    expect(view.queryByText(/Pending Home actions are temporarily unavailable/)).toBeNull();
    expect(initialExecutionTimestamp).not.toBe("");
  });

  test("closes an open transfer detail on account switch without leaking the prior owner", async () => {
    const pendingA = deferred<unknown>();
    const queries: string[] = [];
    let calls = 0;
    const fetchActivity: FetchActivity = (query) => {
      queries.push(query);
      calls += 1;
      return calls === 1
        ? pendingA.promise
        : Promise.resolve(pageFor(query, WALLET_B, { id: "event-2" }));
    };
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={fetchActivity}
      />,
    );
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => {
      pendingA.resolve(pageFor(queries[0]!, WALLET_A));
      await pendingA.promise;
    });

    const detailsButton = await waitFor(() =>
      view.getByRole("button", { description: "View received USDC transaction details" }),
    );
    fireEvent.click(detailsButton);
    expect(view.getByRole("dialog", { name: "Received USDC" })).toBeTruthy();

    view.rerender(
      <ActivityPanel
        session={session("subject-b", WALLET_B)}
        fetchActivity={fetchActivity}
      />,
    );
    await waitFor(() =>
      expect(view.getByText("Loading recent activity…")).toBeTruthy(),
    );
    expect(view.queryByRole("dialog")).toBeNull();
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
    await waitFor(() => expect(view.getByText("Received")).toBeTruthy());

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

  test("manually continues after a finite zero-unique page and appends useful rows", async () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: ControlledIntersectionObserver,
    });
    const queries: string[] = [];
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={async (query) => {
          queries.push(query);
          if (queries.length === 1) {
            return pageFor(query, WALLET_A, {
              id: "event-1",
              blockNumber: "20",
              nextCursor: "cursor-1",
            });
          }
          if (queries.length === 2) {
            return pageFor(query, WALLET_A, {
              empty: true,
              nextCursor: "cursor-2",
            });
          }
          return pageFor(query, WALLET_A, {
            id: "event-2",
            blockNumber: "19",
          });
        }}
      />,
    );

    await waitFor(() => expect(ControlledIntersectionObserver.instances).toHaveLength(1));
    act(() => ControlledIntersectionObserver.instances[0]!.intersect());
    await waitFor(() =>
      expect(view.getByText("Continue loading activity")).toBeTruthy(),
    );
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(1);

    fireEvent.click(view.getByText("Continue loading activity"));
    await waitFor(() => expect(view.getByText("End of activity")).toBeTruthy());
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2);
    expect(queries.map((query) => new URLSearchParams(query).get("cursor"))).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ]);
    expect(new Set(queries.map((query) => new URLSearchParams(query).get("to"))).size).toBe(1);
  });


});
