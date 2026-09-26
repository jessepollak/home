import "../account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActivityPage, ActivityTransfer, FetchActivity } from "./types";
import {
  ACTIVITY_CONTRACT_VERSION,
  type ActivityResponse,
} from "@/shared/activity/contract";
import type { RegionId } from "@/config/regions";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { useActivity } = await import("./use-activity");

const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
const WALLET_B = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const waitedFor = { timeout: 5_000 };
const recoveryWait = { timeout: 7_000 };

function session(
  subject: string,
  address: typeof WALLET_A | typeof WALLET_B,
): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider: "cdp-embedded",
  };
}

function transfer(
  query: string,
  walletAddress: typeof WALLET_A | typeof WALLET_B,
  id: string,
  blockNumber: string,
): ActivityTransfer {
  const to = new URLSearchParams(query).get("to")!;
  const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
  return {
    id: `8453:${tokenAddress}:${id}`,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    tokenImageUrl: null,
    walletAddress,
    fromAddress: OTHER,
    toAddress: walletAddress,
    direction: "incoming",
    amountBaseUnits: blockNumber,
    blockNumber,
    blockHash: `0x${Number(blockNumber).toString(16).padStart(64, "0")}`,
    transactionHash: `0x${Number(blockNumber).toString(16).padStart(64, "0")}`,
    logIndex: "1",
    blockTimestamp: new Date(
      new Date(to).getTime() - (1000 - Number(blockNumber)) * 60_000,
    ).toISOString(),
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
  };
}

function page(
  query: string,
  walletAddress: typeof WALLET_A | typeof WALLET_B,
  transfers: ActivityTransfer[],
  nextCursor: string | null,
): ActivityResponse {
  const to = new URLSearchParams(query).get("to")!;
  return {
    version: ACTIVITY_CONTRACT_VERSION,
    walletAddress,
    chainId: 8453,
    window: {
      from: new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      to,
    },
    currency: (new URLSearchParams(query).get("currency") ?? "USD") as ActivityPage["currency"],
    transfers,
    nextCursor,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: new Date(new Date(to).getTime() - 1000).toISOString(),
      executionTimeMs: 1,
      fetchedAt: to,
    },
  };
}

function priced(row: ActivityTransfer): ActivityTransfer {
  return { ...row, valuation: {
    status: "priced", currency: "USD",
    amount: computeActivityValuationAmount({
      amountBaseUnits: row.amountBaseUnits, tokenDecimals: 6, unitPrice: null, fxRate: null,
    }),
    method: "peg", peg: "USD", close: null, fx: null,
  } };
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

function cursors(queries: readonly string[]): (string | null)[] {
  return queries.map((query) => new URLSearchParams(query).get("cursor"));
}

function HookHarness({
  owner,
  fetchActivity,
  testId = "",
  regionId,
  scheduleValuationRetry,
}: {
  owner: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  testId?: string;
  regionId?: RegionId;
  scheduleValuationRetry?: (run: () => void, delayMs: number) => () => void;
}) {
  const activity = useActivity(owner, fetchActivity, regionId, scheduleValuationRetry);
  return (
    <div>
      <output data-testid={`${testId}status`}>{activity.status}</output>
      {activity.status === "ready" ? (
        <>
          <output data-testid={`${testId}ids`}>
            {activity.page.transfers.map((item) => item.logId).join(",")}
          </output>
          <output data-testid="cursor">{activity.page.nextCursor ?? "end"}</output>
          <output data-testid={`${testId}valuations`}>
            {activity.page.transfers.map((item) => item.valuation.status).join(",")}
          </output>
          <button type="button" onClick={activity.retry}>refetch</button>
          <output data-testid="loading-more">
            {String(activity.loadingMore)}
          </output>
          <output data-testid="load-more-error">
            {String(activity.loadMoreError)}
          </output>
          <output data-testid="continuing">{String(activity.continuing)}</output>
          <button type="button" onClick={() => activity.setSentinelVisible(true)}>
            sentinel visible
          </button>
          <button type="button" onClick={() => activity.setSentinelVisible(false)}>
            sentinel hidden
          </button>
          <button type="button" onClick={activity.retryLoadMore}>manual retry</button>
        </>
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
  getHomeQueryClient().clear();
});

describe("useActivity pagination", () => {
  test("requests the region's presentation currency and keeps a known value through a transient quote failure", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "event-30", "30");
      const currency = new URLSearchParams(query).get("currency") as ActivityPage["currency"];
      row.valuation = queries.length === 1
        ? {
            status: "priced",
            currency,
            amount: computeActivityValuationAmount({
              amountBaseUnits: "30",
              tokenDecimals: 6,
              unitPrice: null,
              fxRate: { atoms: "86", scale: 2 },
            }),
            method: "peg",
            peg: "USD",
            close: null,
            fx: {
              provider: "Coinbase",
              base: "USD",
              quote: currency,
              date: row.blockTimestamp.slice(0, 10),
              rate: { atoms: "86", scale: 2 },
              provisional: false,
            },
          }
        : { status: "unpriced", currency, reason: "quote-unavailable" };
      return page(query, WALLET_A, [row], null);
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} regionId="DE" />,
    );

    await waitFor(() => expect(view.getByTestId("valuations").textContent).toBe("priced"));
    expect(new URLSearchParams(queries[0]).get("currency")).toBe("EUR");
    fireEvent.click(view.getByText("refetch"));
    await waitFor(() => expect(queries).toHaveLength(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.getByTestId("valuations").textContent).toBe("priced");
  });

  test("two hooks for one owner share one activity query", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      return page(query, WALLET_A, [], null);
    };
    const activeSession = session("subject-a", WALLET_A);
    const view = render(
      <>
        <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="first-" />
        <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="second-" />
      </>,
    );

    await waitFor(() => expect(view.getByTestId("first-status").textContent).toBe("ready"));
    expect(view.getByTestId("second-status").textContent).toBe("ready");
    expect(queries).toHaveLength(1);
  });

  test("keeps one fixed window, blocks concurrent loads, and appends deduplicated ordered pages", async () => {
    const pendingSecond = deferred<unknown>();
    const pendingThird = deferred<unknown>();
    const queries: string[] = [];
    let firstTransfer: ActivityTransfer | null = null;
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        firstTransfer = transfer(query, WALLET_A, "event-30", "30");
        return page(query, WALLET_A, [firstTransfer], "cursor-1");
      }
      if (queries.length === 2) return pendingSecond.promise;
      return pendingThird.promise;
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );

    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    fireEvent.click(view.getByText("sentinel visible"));
    expect(queries).toHaveLength(2);
    await waitFor(() =>
      expect(view.getByTestId("loading-more").textContent).toBe("true"),
    );

    await act(async () => {
      const secondQuery = queries[1]!;
      pendingSecond.resolve(
        page(
          secondQuery,
          WALLET_A,
          [
            firstTransfer!,
            transfer(secondQuery, WALLET_A, "event-20", "20"),
          ],
          "cursor-2",
        ),
      );
      await pendingSecond.promise;
    });
    await waitFor(() =>
      expect(view.getByTestId("ids").textContent).toBe("event-30,event-20"),
    );
    await waitFor(() => expect(queries).toHaveLength(3));
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");

    await act(async () => {
      const thirdQuery = queries[2]!;
      pendingThird.resolve(
        page(thirdQuery, WALLET_A, [transfer(thirdQuery, WALLET_A, "event-10", "10")], null),
      );
      await pendingThird.promise;
    });
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), waitedFor);
    expect(view.getByTestId("ids").textContent).toBe(
      "event-30,event-20,event-10",
    );
    expect(queries).toHaveLength(3);
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-2"]);
    const windowEnds = queries.map((query) => new URLSearchParams(query).get("to"));
    expect(new Set(windowEnds).size).toBe(1);
  });

  test("continues automatically through empty and duplicate-only pages until an authoritative end", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-30", "30")],
          "cursor-1",
        );
      }
      if (queries.length === 2) {
        return page(query, WALLET_A, [], "cursor-2");
      }
      if (queries.length === 3) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-30", "30")],
          "cursor-3",
        );
      }
      if (queries.length === 4) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-20", "20")],
          "cursor-4",
        );
      }
      return page(query, WALLET_A, [], null);
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );

    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), waitedFor);

    expect(cursors(queries)).toEqual([
      null,
      "cursor-1",
      "cursor-2",
      "cursor-3",
      "cursor-4",
    ]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  });

  test("stops while the sentinel is hidden and resumes from the same cursor when it returns", async () => {
    const pendingSecond = deferred<unknown>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-30", "30")],
          "cursor-1",
        );
      }
      if (queries.length === 2) return pendingSecond.promise;
      return page(
        query,
        WALLET_A,
        [transfer(query, WALLET_A, "event-20", "20")],
        null,
      );
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );

    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    expect(queries).toHaveLength(2);
    fireEvent.click(view.getByText("sentinel hidden"));

    await act(async () => {
      const secondQuery = queries[1]!;
      pendingSecond.resolve(
        page(
          secondQuery,
          WALLET_A,
          [transfer(secondQuery, WALLET_A, "event-20", "20")],
          "cursor-2",
        ),
      );
      await pendingSecond.promise;
    });
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-2"));
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("continuing").textContent).toBe("false");
    expect(queries).toHaveLength(2);

    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(queries).toHaveLength(3), waitedFor);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), waitedFor);
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-2"]);
  });

  test("recovers a transient later-page failure without showing Retry and continues to exhaustion", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) throw new Error("transient later page failure");
      if (new URLSearchParams(query).get("cursor") === "cursor-1") {
        return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], "cursor-2");
      }
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-10", "10")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    const errors: string[] = [];
    const observer = new MutationObserver(() => { errors.push(view.queryByTestId("load-more-error")?.textContent ?? ""); });
    observer.observe(view.container, { subtree: true, childList: true, characterData: true });
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(queries).toHaveLength(2));
    await waitFor(() => expect(view.getByTestId("continuing").textContent).toBe("true"));
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), recoveryWait);
    observer.disconnect();
    expect(errors).not.toContain("true");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-2"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20,event-10");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  });

  test("keeps the retry backoff when the sentinel leaves and returns during the wait", async () => {
    const queries: string[] = [];
    const requestedAt: number[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      requestedAt.push(Date.now());
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) throw new Error("transient later page failure");
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(queries).toHaveLength(2));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(view.getByText("sentinel hidden"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), recoveryWait);
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1"]);
    expect(requestedAt[2]! - requestedAt[1]!).toBeGreaterThanOrEqual(900);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

  test("exhausts two automatic retries, preserves rows, then manually retries the exact cursor", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length < 5) throw new Error("later page unavailable");
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(queries).toHaveLength(2));
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    expect(view.getByTestId("continuing").textContent).toBe("true");
    await waitFor(() => expect(view.getByTestId("load-more-error").textContent).toBe("true"), recoveryWait);
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    expect(view.getByTestId("continuing").textContent).toBe("false");
    fireEvent.click(view.getByText("sentinel visible"));
    expect(queries).toHaveLength(4);
    fireEvent.click(view.getByText("manual retry"));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"));
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  }, 10_000);

  test("a next-page request joined to an in-flight refetch does not consume the cursor", async () => {
    const refetch = deferred<unknown>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) return refetch.promise;
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("refetch"));
    await waitFor(() => expect(queries).toHaveLength(2));
    fireEvent.click(view.getByText("sentinel visible"));
    await act(async () => {
      refetch.resolve(page(queries[1]!, WALLET_A, [transfer(queries[1]!, WALLET_A, "event-30", "30")], "cursor-1"));
      await refetch.promise;
    });
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), waitedFor);
    expect(cursors(queries)).toEqual([null, null, "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

  test("a joined failed background refetch uses the same bounded retry budget", async () => {
    const refetch = deferred<unknown>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) return refetch.promise;
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("refetch"));
    await waitFor(() => expect(queries).toHaveLength(2));
    fireEvent.click(view.getByText("sentinel visible"));
    await act(async () => { refetch.reject(new Error("background refetch unavailable")); await refetch.promise.catch(() => undefined); });
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    expect(view.getByTestId("continuing").textContent).toBe("true");
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"), recoveryWait);
    expect(cursors(queries)).toEqual([null, null, "cursor-1"]);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

  test("bounds non-advancing cursor retries without losing earlier rows", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      }
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], "cursor-1");
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(view.getByTestId("load-more-error").textContent).toBe("true"), recoveryWait);
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  }, 10_000);

  test("rejects a cyclic cursor without issuing a further request", async () => {
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-30", "30")],
          "cursor-1",
        );
      }
      if (queries.length === 2) {
        return page(
          query,
          WALLET_A,
          [transfer(query, WALLET_A, "event-20", "20")],
          "cursor-2",
        );
      }
      return page(
        query,
        WALLET_A,
        [transfer(query, WALLET_A, "event-10", "10")],
        "cursor-1",
      );
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );

    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() =>
      expect(view.getByTestId("load-more-error").textContent).toBe("true"),
      waitedFor,
    );
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-2"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20,event-10");
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  });

  test("aborts an in-flight later page and ignores it after the owner changes", async () => {
    const laterPage = deferred<unknown>();
    const signals: AbortSignal[] = [];
    const queries: string[] = [];
    const fetchActivity: FetchActivity = (query, signal) => {
      queries.push(query);
      signals.push(signal!);
      if (queries.length === 1) {
        return Promise.resolve(
          page(
            query,
            WALLET_A,
            [transfer(query, WALLET_A, "owner-a", "30")],
            "cursor-a",
          ),
        );
      }
      if (queries.length === 2) return laterPage.promise;
      return Promise.resolve(
        page(
          query,
          WALLET_B,
          [transfer(query, WALLET_B, "owner-b", "40")],
          null,
        ),
      );
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );
    await waitFor(() => expect(view.getByTestId("ids").textContent).toBe("owner-a"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(queries).toHaveLength(2));

    view.rerender(
      <HookHarness owner={session("subject-b", WALLET_B)} fetchActivity={fetchActivity} />,
    );
    await waitFor(() => expect(queries).toHaveLength(3));
    expect(signals[1]?.aborted).toBe(true);
    await waitFor(() => expect(view.getByTestId("ids").textContent).toBe("owner-b"));

    await act(async () => {
      laterPage.resolve(
        page(
          queries[1]!,
          WALLET_A,
          [transfer(queries[1]!, WALLET_A, "stale-owner-a", "20")],
          null,
        ),
      );
      await laterPage.promise;
    });
    expect(view.getByTestId("ids").textContent).toBe("owner-b");
    expect(view.getByTestId("continuing").textContent).toBe("false");
    expect(queries).toHaveLength(3);
  });
});

function manualValuationRetry() {
  const pending: { run: () => void; delayMs: number }[] = [];
  const schedule = (run: () => void, delayMs: number) => {
    const task = { run, delayMs };
    pending.push(task);
    return () => {
      const index = pending.indexOf(task);
      if (index !== -1) pending.splice(index, 1);
    };
  };
  const fire = async (delayMs: number) => {
    expect(pending.map((task) => task.delayMs)).toEqual([delayMs]);
    const task = pending.shift()!;
    await act(async () => {
      task.run();
      await Promise.resolve();
    });
  };
  return { pending, schedule, fire };
}

describe("useActivity valuation recovery", () => {
  test("revalues an unpriced transfer without a new transaction after 15 seconds", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "same-transfer", "999");
      return page(query, WALLET_A, [queries.length === 1 ? row : priced(row)], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    expect(view.getByTestId("valuations").textContent).toBe("unpriced");
    expect(queries).toHaveLength(1);
    await scheduler.fire(15_000);
    await waitFor(() => expect(view.getByTestId("valuations").textContent).toBe("priced"));
    expect(cursors(queries)).toEqual([null, null]);
    expect(view.getByTestId("ids").textContent).toBe("same-transfer");
    expect(scheduler.pending).toHaveLength(0);
  });

  test("caps three whole-query retries even when continuation pages stay unpriced", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const cursor = new URLSearchParams(query).get("cursor");
      return cursor ? page(query, WALLET_A, [transfer(query, WALLET_A, "older", "20")], null)
        : page(query, WALLET_A, [transfer(query, WALLET_A, "newer", "30")], "cursor-1");
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(cursors(queries)).toEqual([null, "cursor-1"]));
    for (const [index, delay] of [15_000, 60_000, 180_000].entries()) {
      await waitFor(() => expect(scheduler.pending).toHaveLength(1));
      await scheduler.fire(delay);
      await waitFor(() => expect(queries).toHaveLength((index + 2) * 2));
      expect(cursors(queries).slice(-2)).toEqual([null, "cursor-1"]);
    }
    expect(scheduler.pending).toHaveLength(0);
    expect(view.getByTestId("valuations").textContent).toBe("unpriced,unpriced");
  });

  test.each(["unknown-token", "no-recent-close"] as const)("never retries nonrecoverable %s", async (reason) => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "event", reason === "unknown-token" ? "999" : "30");
      row.valuation = { status: "unpriced", currency: "USD", reason };
      return page(query, WALLET_A, [row], null);
    };
    render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(queries).toHaveLength(1));
    expect(scheduler.pending).toHaveLength(0);
  });

  test("retries a no-recent-close within 60 minutes of the window end", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "recent", "999");
      row.valuation = { status: "unpriced", currency: "USD", reason: "no-recent-close" };
      return page(query, WALLET_A, [row], null);
    };
    render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    await scheduler.fire(15_000);
    await waitFor(() => expect(queries).toHaveLength(2));
  });

  test("keeps a priced row when a retry reports no-recent-close", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "priced", "999");
      row.valuation = { status: "unpriced", currency: "USD", reason: "no-recent-close" };
      return page(query, WALLET_A, [queries.length === 2 ? priced(row) : row], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    await scheduler.fire(15_000);
    await waitFor(() => expect(view.getByTestId("valuations").textContent).toBe("priced"));
    fireEvent.click(view.getByText("refetch"));
    await waitFor(() => expect(queries).toHaveLength(3));
    expect(view.getByTestId("valuations").textContent).toBe("priced");
    expect(scheduler.pending).toHaveLength(0);
  });

  test.each(["unpriced-first", "priced-first"] as const)("prefers priced duplicate across pages: %s", async (order) => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const row = transfer(query, WALLET_A, "duplicate", "30");
      const isFirst = !new URLSearchParams(query).has("cursor");
      return page(query, WALLET_A, [(order === "unpriced-first") === isFirst ? row : priced(row)], isFirst ? "cursor-1" : null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(view.getByTestId("status").textContent).toBe("ready"));
    fireEvent.click(view.getByText("sentinel visible"));
    await waitFor(() => expect(cursors(queries)).toEqual([null, "cursor-1"]));
    await waitFor(() => expect(view.getByTestId("valuations").textContent).toBe("priced"));
    expect(view.getByTestId("ids").textContent).toBe("duplicate");
    expect(scheduler.pending).toHaveLength(0);
  });

  test("resets the retry budget when the owner changes", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const wallet = queries.length <= 4 ? WALLET_A : WALLET_B;
      return page(query, wallet, [transfer(query, wallet, "unpriced", "999")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    for (const [index, delay] of [15_000, 60_000, 180_000].entries()) {
      await waitFor(() => expect(scheduler.pending).toHaveLength(1));
      await scheduler.fire(delay);
      await waitFor(() => expect(queries).toHaveLength(index + 2));
    }
    expect(scheduler.pending).toHaveLength(0);
    view.rerender(<HookHarness owner={session("subject-b", WALLET_B)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    expect(queries).toHaveLength(5);
    await scheduler.fire(15_000);
    await waitFor(() => expect(queries).toHaveLength(6));
    expect(new URLSearchParams(queries[5]).get("to")).toBe(new URLSearchParams(queries[4]).get("to"));
  });

  test("shares one three-attempt budget across consumers and remounts", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      return page(query, WALLET_A, [transfer(query, WALLET_A, "unpriced", "999")], null);
    };
    const activeSession = session("subject-a", WALLET_A);
    const first = <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="first-" scheduleValuationRetry={scheduler.schedule} />;
    const second = <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="second-" scheduleValuationRetry={scheduler.schedule} />;
    const view = render(<>{first}{second}</>);
    await waitFor(() => expect(view.getByTestId("second-status").textContent).toBe("ready"));
    expect(queries).toHaveLength(1);
    expect(scheduler.pending).toHaveLength(1);
    for (const [index, delay] of [15_000, 60_000, 180_000].entries()) {
      await scheduler.fire(delay);
      await waitFor(() => expect(queries).toHaveLength(index + 2));
      if (index < 2) await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    }
    expect(queries).toHaveLength(4);
    expect(scheduler.pending).toHaveLength(0);
    view.rerender(<>{first}</>);
    view.rerender(<>{first}{second}</>);
    await waitFor(() => expect(view.getByTestId("second-status").textContent).toBe("ready"));
    expect(scheduler.pending).toHaveLength(0);
    expect(queries).toHaveLength(4);
    view.unmount();
    getHomeQueryClient().clear();
    render(<HookHarness owner={activeSession} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
    await waitFor(() => expect(queries).toHaveLength(5));
    await waitFor(() => expect(scheduler.pending.map((task) => task.delayMs)).toEqual([15_000]));
  });

  test("keeps the shared timer until the last consumer unmounts", async () => {
    const scheduler = manualValuationRetry();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      return page(query, WALLET_A, [transfer(query, WALLET_A, "unpriced", "999")], null);
    };
    const activeSession = session("subject-a", WALLET_A);
    const first = <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="first-" scheduleValuationRetry={scheduler.schedule} />;
    const second = <HookHarness owner={activeSession} fetchActivity={fetchActivity} testId="second-" scheduleValuationRetry={scheduler.schedule} />;
    const view = render(<>{first}{second}</>);
    await waitFor(() => expect(scheduler.pending).toHaveLength(1));
    view.rerender(<>{second}</>);
    expect(scheduler.pending.map((task) => task.delayMs)).toEqual([15_000]);
    view.rerender(<></>);
    expect(scheduler.pending).toHaveLength(0);
    expect(queries).toHaveLength(1);
  });

  test("skips a hidden scheduled retry without spending its attempt", async () => {
    const scheduler = manualValuationRetry();
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let hidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    try {
      const queries: string[] = [];
      const fetchActivity: FetchActivity = async (query) => {
        queries.push(query);
        return page(query, WALLET_A, [transfer(query, WALLET_A, "unpriced", "999")], null);
      };
      const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
      await waitFor(() => expect(scheduler.pending).toHaveLength(1));
      hidden = true;
      await scheduler.fire(15_000);
      expect(queries).toHaveLength(1);
      expect(scheduler.pending).toHaveLength(0);
      hidden = false;
      fireEvent.click(view.getByText("refetch"));
      await waitFor(() => expect(scheduler.pending).toHaveLength(1));
      expect(queries).toHaveLength(2);
      await scheduler.fire(15_000);
      await waitFor(() => expect(queries).toHaveLength(3));
    } finally {
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    }
  });
});

test("waits for a continuation fetch to settle before spending a retry", async () => {
  const scheduler = manualValuationRetry();
  const pending = deferred<unknown>();
  const queries: string[] = [];
  const fetchActivity: FetchActivity = async (query) => {
    queries.push(query);
    if (new URLSearchParams(query).has("cursor")) {
      if (queries.length === 2) return pending.promise;
      return page(query, WALLET_A, [transfer(query, WALLET_A, "older", "20")], null);
    }
    return page(query, WALLET_A, [transfer(query, WALLET_A, "newer", "30")], "cursor-1");
  };
  const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} scheduleValuationRetry={scheduler.schedule} />);
  await waitFor(() => expect(scheduler.pending).toHaveLength(1));
  fireEvent.click(view.getByText("sentinel visible"));
  await waitFor(() => expect(cursors(queries)).toEqual([null, "cursor-1"]));
  expect(scheduler.pending).toHaveLength(0);
  await act(async () => {
    pending.resolve(page(queries[1]!, WALLET_A, [transfer(queries[1]!, WALLET_A, "older", "20")], null));
    await pending.promise;
  });
  await waitFor(() => expect(scheduler.pending).toHaveLength(1));
  expect(queries).toHaveLength(2);
  await scheduler.fire(15_000);
  await waitFor(() => expect(cursors(queries)).toEqual([null, "cursor-1", null, "cursor-1"]));
});
