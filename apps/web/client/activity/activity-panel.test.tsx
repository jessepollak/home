import "../account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import {
  ACTIVITY_TEASER_LIMIT,
  type ActivityPage,
  type FetchActivity,
} from "./types";

const { act, cleanup, fireEvent, render, waitFor, within } = await import(
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

afterEach(() => {
  cleanup();
  ControlledIntersectionObserver.instances = [];
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: originalIntersectionObserver,
  });
});

describe("ActivityPanel", () => {
  test("renders direction, bounded shared amount formatting, and details without Refresh chrome", async () => {
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
    expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(view.queryByText(/^Updated(\s|$)/)).toBeNull();
    expect(view.queryByText("Data may be delayed")).toBeNull();
    expect(view.queryByText("Activity coverage")).toBeNull();
    expect(view.queryByRole("link", { name: "View on BaseScan" })).toBeNull();

    fireEvent.click(
      view.getByRole("button", { name: "View received USDC transaction details" }),
    );
    const dialog = view.getByRole("dialog", { name: "Received USDC" });
    expect(
      within(dialog).getByRole("link", { name: "View on BaseScan" }),
    ).toHaveProperty(
      "href",
      `https://basescan.org/tx/0x${"a".repeat(64)}`,
    );
    expect(within(dialog).getByText("+1234567.89 USDC")).toBeTruthy();
    expect(within(dialog).getByText("Confirmed")).toBeTruthy();
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
    expect(view.getByText("+10.00 USDC")).toBeTruthy();
  });

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
      expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(2),
    );
    const firstQuery = new URLSearchParams(queries[0]);
    const secondQuery = new URLSearchParams(queries[1]);
    expect(secondQuery.get("to")).toBe(firstQuery.get("to"));
    expect(secondQuery.get("cursor")).toBe("cursor-1");
    expect(view.queryByText(/Updated /)).toBeNull();
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

    fireEvent.click(
      view.getByRole("button", { name: "View received USDC transaction details" }),
    );
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

  test("uses the authenticated main as its sentinel root and exposes loading and end states", async () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: ControlledIntersectionObserver,
    });
    const pending = deferred<unknown>();
    const hashes: string[][] = [];
    const queries: string[] = [];
    let calls = 0;
    const view = render(
      <main className="app-main app-main-authenticated" data-testid="scroll-root">
        <ActivityPanel
          session={session("subject-a", WALLET_A)}
          onTransactionHashesChange={(next) => hashes.push(next)}
          fetchActivity={async (query) => {
            queries.push(query);
            calls += 1;
            if (calls === 1) {
              return pageFor(query, WALLET_A, {
                id: "event-1",
                blockNumber: "20",
                nextCursor: "cursor-1",
              });
            }
            return pending.promise;
          }}
        />
      </main>,
    );

    await waitFor(() => expect(ControlledIntersectionObserver.instances).toHaveLength(1));
    const observer = ControlledIntersectionObserver.instances[0]!;
    expect(observer.root).toBe(view.getByTestId("scroll-root"));
    expect(observer.rootMargin).toBe("0px 0px 240px 0px");

    act(() => observer.intersect());
    await waitFor(() => expect(view.getByText("Loading more activity…")).toBeTruthy());
    expect(calls).toBe(2);
    const loadingButton = view.getByRole("button", { name: "Loading…" });
    expect(loadingButton).toBeTruthy();
    expect(loadingButton.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      pending.resolve(pageFor(queries[1]!, WALLET_A, {
        id: "event-2",
        blockNumber: "19",
      }));
      await pending.promise;
    });
    await waitFor(() => expect(view.getByText("End of activity")).toBeTruthy());
    expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(2);
    await waitFor(() =>
      expect(hashes.at(-1)).toEqual([
        `0x${"a".repeat(64)}`,
        `0x${"b".repeat(64)}`,
      ]),
    );
  });

  for (const pageKind of ["empty", "overlap"] as const) {
    test(`pauses native observer loading after a fresh-cursor ${pageKind} page`, async () => {
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
            return pageFor(query, WALLET_A, {
              id: "event-1",
              blockNumber: "20",
              nextCursor: `cursor-${queries.length}`,
              empty: pageKind === "empty",
            });
          }}
        />,
      );

      await waitFor(() => expect(ControlledIntersectionObserver.instances).toHaveLength(1));
      act(() => ControlledIntersectionObserver.instances[0]!.intersect());
      await waitFor(() =>
        expect(view.getByText("Continue loading activity")).toBeTruthy(),
      );
      expect(queries).toHaveLength(2);
      expect(new URLSearchParams(queries[1]).get("cursor")).toBe("cursor-1");
      expect(
        view.getByText(
          "No additional activity was found on that page. Continue to check older activity.",
        ),
      ).toBeTruthy();
      expect(view.queryByText("End of activity")).toBeNull();
      expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(1);

      act(() => {
        for (const observer of ControlledIntersectionObserver.instances) {
          observer.intersect();
          observer.intersect();
        }
      });
      await act(async () => Promise.resolve());
      expect(queries).toHaveLength(2);
    });
  }

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
    expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(1);

    fireEvent.click(view.getByText("Continue loading activity"));
    await waitFor(() => expect(view.getByText("End of activity")).toBeTruthy());
    expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(2);
    expect(queries.map((query) => new URLSearchParams(query).get("cursor"))).toEqual([
      null,
      "cursor-1",
      "cursor-2",
    ]);
    expect(new Set(queries.map((query) => new URLSearchParams(query).get("to"))).size).toBe(1);
  });

  test("teaser density caps rows and hides Load more without Refresh chrome", async () => {
    const view = render(
      <ActivityPanel
        session={session("subject-a", WALLET_A)}
        density="teaser"
        fetchActivity={async (query) => {
          const first = pageFor(query, WALLET_A, {
            id: "event-1",
            nextCursor: "cursor-1",
          });
          return {
            ...first,
            transfers: Array.from({ length: ACTIVITY_TEASER_LIMIT + 2 }, (_, index) => ({
              ...first.transfers[0]!,
              id: `event-${index + 1}`,
              blockNumber: String(20 - index),
              logIndex: String(index + 1),
              transactionHash: `0x${(10 + index).toString(16).padStart(64, "0")}`,
            })),
          };
        }}
      />,
    );

    await waitFor(() =>
      expect(view.getAllByRole("button", { name: /transaction details/ })).toHaveLength(
        ACTIVITY_TEASER_LIMIT,
      ),
    );
    expect(view.queryByRole("button", { name: "Load more activity" })).toBeNull();
    expect(view.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(view.queryByText(/^Updated(\s|$)/)).toBeNull();
  });
});
