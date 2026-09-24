import "../account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_CONTRACT_VERSION,
  type ActivityResponse,
} from "@/shared/activity/contract";
import type { FetchActivity } from "./types";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { ActivityPanelView } = await import("./activity-panel");
const { ConnectedActivityPanel } = await import("@/client/home/activity-panel");

const noOperations = async () => ({ actions: [] });

function ActivityPanel({
  session,
  fetchActivity,
}: {
  session: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
}) {
  return (
    <ConnectedActivityPanel
      density="page"
      activitySession={session}
      fetchActivity={fetchActivity}
      fetchOperations={noOperations}
      regionId="US"
    />
  );
}

const waitedFor = { timeout: 5_000 };

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
    this.emit(true);
  }

  leave() {
    this.emit(false);
  }

  private emit(isIntersecting: boolean) {
    if (!this.target) return;
    const rect = this.target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: rect,
          isIntersecting,
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
): ActivityResponse {
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
    version: ACTIVITY_CONTRACT_VERSION,
    walletAddress,
    chainId: 8453,
    window: { from, to },
    currency: "USD",
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
            valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
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

function installControlledObserver() {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: ControlledIntersectionObserver,
  });
}

function requestedCursors(queries: readonly string[]): (string | null)[] {
  return queries.map((query) => new URLSearchParams(query).get("cursor"));
}

async function waitForSentinel() {
  await waitFor(() =>
    expect(ControlledIntersectionObserver.instances).toHaveLength(1),
  );
  return ControlledIntersectionObserver.instances[0]!;
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

describe("ConnectedActivityPanel", () => {
  test("initial load stays pending until both sources settle", () => {
    const activityPage = pageFor("to=2026-09-13T12%3A00%3A00.000Z", WALLET_A);
    const view = render(
      <ActivityPanelView
        activity={{
          status: "ready",
          page: activityPage,
          loadingMore: false,
          loadMoreError: false,
          continuing: false,
          retry: () => {},
          refresh: () => {},
          setSentinelVisible: () => {},
          retryLoadMore: () => {},
        }}
        actionsStatus="loading"
      />,
    );

    expect(view.getByText("Loading recent activity…")).toBeTruthy();
    expect(view.queryByRole("button", { description: /transaction details/ })).toBeNull();
  });

  test("keeps the pagination window stable while deduplicating overlap", async () => {
    installControlledObserver();
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

    const observer = await waitForSentinel();
    act(() => observer.intersect());
    await waitFor(() =>
      expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2),
    );
    expect(view.getByText("End of activity")).toBeTruthy();
    expect(view.queryByText(/Data may be delayed/)).toBeNull();
    expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(queries).toHaveLength(2);
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

  test("continues automatically through advancing empty pages without manual controls", async () => {
    installControlledObserver();
    const pendingEmpty = deferred<unknown>();
    const pendingFinal = deferred<unknown>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return Promise.resolve(pageFor(query, WALLET_A, {
          id: "event-1",
          blockNumber: "20",
          nextCursor: "cursor-1",
        }));
      }
      if (queries.length === 2) return pendingEmpty.promise;
      return pendingFinal.promise;
    };
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        fetchActivity={fetchActivity}
      />,
    );

    const observer = await waitForSentinel();
    act(() => observer.intersect());
    await waitFor(() => expect(queries).toHaveLength(2));
    const announcement = view.getByText("Loading older activity");

    await act(async () => {
      const emptyQuery = queries[1]!;
      pendingEmpty.resolve(pageFor(emptyQuery, WALLET_A, {
        empty: true,
        nextCursor: "cursor-2",
      }));
      await pendingEmpty.promise;
    });
    await waitFor(() => expect(queries).toHaveLength(3), waitedFor);
    expect(view.getByText("Loading older activity")).toBe(announcement);

    await act(async () => {
      const finalQuery = queries[2]!;
      pendingFinal.resolve(pageFor(finalQuery, WALLET_A, {
        id: "event-2",
        blockNumber: "19",
      }));
      await pendingFinal.promise;
    });
    await waitFor(() => expect(view.getByText("End of activity")).toBeTruthy(), waitedFor);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2);
    expect(view.queryByText("Continue loading activity")).toBeNull();
    expect(view.queryByText("Load more activity")).toBeNull();
    expect(view.queryByText(/No additional activity was found/)).toBeNull();
    expect(view.queryAllByText("Loading older activity")).toHaveLength(0);
    expect(requestedCursors(queries)).toEqual([null, "cursor-1", "cursor-2"]);
    expect(new Set(queries.map((query) => new URLSearchParams(query).get("to"))).size).toBe(1);
  });

  test("keeps rows and the list node while retrying the exact cursor after a later-page failure", async () => {
    installControlledObserver();
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
          if (queries.length === 2) throw new Error("later page unavailable");
          if (queries.length === 3) {
            return pageFor(query, WALLET_A, {
              id: "event-2",
              blockNumber: "19",
              nextCursor: "cursor-2",
            });
          }
          return pageFor(query, WALLET_A, {
            id: "event-3",
            blockNumber: "18",
          });
        }}
      />,
    );

    const observer = await waitForSentinel();
    act(() => observer.intersect());
    const retry = await waitFor(() =>
      view.getByRole("button", { name: "Retry" }),
    );
    const list = view.getByRole("list");
    expect(view.getByText("More activity could not be loaded. Your current results are unchanged.")).toBeTruthy();
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(1);
    expect(requestedCursors(queries)).toEqual([null, "cursor-1"]);

    fireEvent.click(retry);
    await waitFor(() =>
      expect(view.getByText("End of activity")).toBeTruthy(),
      waitedFor,
    );
    expect(requestedCursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-2"]);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(3);
    expect(view.getByRole("list")).toBe(list);
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("stops requesting while the sentinel is offscreen and resumes when it returns", async () => {
    installControlledObserver();
    const pendingSecond = deferred<unknown>();
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
          if (queries.length === 2) return pendingSecond.promise;
          return pageFor(query, WALLET_A, {
            id: "event-3",
            blockNumber: "18",
          });
        }}
      />,
    );

    const observer = await waitForSentinel();
    act(() => observer.intersect());
    await waitFor(() => expect(queries).toHaveLength(2));
    act(() => observer.leave());

    await act(async () => {
      const secondQuery = queries[1]!;
      pendingSecond.resolve(pageFor(secondQuery, WALLET_A, {
        id: "event-2",
        blockNumber: "19",
        nextCursor: "cursor-2",
      }));
      await pendingSecond.promise;
    });
    await waitFor(() =>
      expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2),
    );
    expect(requestedCursors(queries)).toEqual([null, "cursor-1"]);
    expect(view.queryByText("End of activity")).toBeNull();

    act(() => observer.intersect());
    await waitFor(() => expect(queries).toHaveLength(3), waitedFor);
    await waitFor(() => expect(view.getByText("End of activity")).toBeTruthy(), waitedFor);
    expect(requestedCursors(queries)).toEqual([null, "cursor-1", "cursor-2"]);
  });

  test("rejects a repeated cursor without a request storm and offers only Retry", async () => {
    installControlledObserver();
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
          return pageFor(query, WALLET_A, {
            id: "event-2",
            blockNumber: "19",
            nextCursor: "cursor-1",
          });
        }}
      />,
    );

    const observer = await waitForSentinel();
    act(() => observer.intersect());
    await waitFor(() => expect(view.getByRole("button", { name: "Retry" })).toBeTruthy(), waitedFor);
    expect(requestedCursors(queries)).toEqual([null, "cursor-1"]);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(1);
    expect(view.queryByText("End of activity")).toBeNull();
  });
});
