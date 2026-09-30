import "../account/dom-test-harness";

import { clearOwnerQueryBoundary, getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
import { afterEach, describe, expect, jest, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActivityPage, ActivityTransfer, FetchActivity } from "./types";
import {
  ACTIVITY_CONTRACT_VERSION,
  type ActivityResponse,
} from "@/shared/activity/contract";
import type { RegionId } from "@/config/regions";
import { computeActivityValuationAmount } from "@/shared/activity/valuation";
import { ResourceFailure } from "@/client/account/resource-failure";
import { activityWindowScope, invalidateAfterAction, nextActivityWindowEnd } from "@/client/query/after-action";
import { initialActivityWindowEnd } from "@/client/query/after-action";
import { defaultScheduler, notifyManager, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { transfersReadiness } from "./activity-sources";

const { act, cleanup, fireEvent, render, renderHook, waitFor } = await import(
  "@testing-library/react"
);
const { useActivity, activityOwnerKey, activityFirstPageRetryDelaysMs, activityLatestReadTimeoutMs, refreshLatestActivity, refreshActivityThroughController } = await import("./use-activity");

const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
const WALLET_B = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const waitedFor = { timeout: 5_000 };

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
const cardPurchase = {
  id: "ipi_synthetic", kind: "transaction" as const, amountMinor: "1234", currency: "USD",
  merchantName: "Synthetic Cafe", merchantCategory: null, status: "completed" as const,
  declineReasonCode: null, createdAt: "2026-09-07T12:00:00.000Z", updatedAt: "2026-09-07T12:00:00.000Z",
} satisfies NonNullable<ActivityPage["cards"]>["rows"][number];

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

function partialPage(query: string, wallet: typeof WALLET_A | typeof WALLET_B, rows: NonNullable<ActivityPage["cards"]>["rows"] = []): ActivityResponse {
  return { ...page(query, wallet, [], null), source: null, onchainStatus: "unavailable",
    cards: { status: "ready", rows } };
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

const paginationRetryNow = Date.parse("2026-09-28T12:00:00.000Z");

async function flushContinuation() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

async function settleContinuation() {
  await act(async () => {
    await flushContinuation();
  });
}

async function advanceContinuation(delayMs: number) {
  await act(async () => {
    jest.advanceTimersByTime(delayMs);
    await flushContinuation();
  });
}

function controlPaginationClock() {
  jest.useFakeTimers({ now: paginationRetryNow });
  notifyManager.setScheduler((callback) => queueMicrotask(callback));
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
  const activity = useActivity(owner, fetchActivity, regionId, { scheduleValuationRetry });
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
          <output data-testid={`${testId}onchain-status`}>{activity.page.onchainStatus ?? "healthy"}</output>
          <output data-testid={`${testId}latest-unavailable`}>{String(activity.latestUnavailable === true)}</output>
          <output data-testid={`${testId}currency`}>{activity.page.currency}</output>
          <output data-testid={`${testId}card-ids`}>{activity.page.cards?.rows.map((row) => row.id).join(",") ?? ""}</output>
          <output data-testid={`${testId}card-statuses`}>{activity.page.cards?.rows.map((row) => row.status).join(",") ?? ""}</output>
          <button type="button" data-testid={`${testId}refetch`} onClick={activity.retry}>refetch</button>
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
  notifyManager.setScheduler(defaultScheduler);
  cleanup();
  getHomeQueryClient().clear();
  jest.useRealTimers();
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
    controlPaginationClock();
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
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    const errors: string[] = [];
    const observer = new MutationObserver(() => { errors.push(view.queryByTestId("load-more-error")?.textContent ?? ""); });
    observer.observe(view.container, { subtree: true, childList: true, characterData: true });
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    expect(view.getByTestId("continuing").textContent).toBe("true");
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    await advanceContinuation(1_000);
    expect(queries).toHaveLength(3);
    await advanceContinuation(0);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("end");
    observer.disconnect();
    expect(errors).not.toContain("true");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-2"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20,event-10");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  });

  test("keeps the retry backoff when the sentinel leaves and returns during the wait", async () => {
    controlPaginationClock();
    jest.useFakeTimers({ now: paginationRetryNow });
    const queries: string[] = [];
    const requestedAt: number[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      requestedAt.push(Date.now() - paginationRetryNow);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) throw new Error("transient later page failure");
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    fireEvent.click(view.getByText("sentinel hidden"));
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    await advanceContinuation(999);
    expect(queries).toHaveLength(2);
    await advanceContinuation(1);
    expect(queries).toHaveLength(3);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("end");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1"]);
    expect(requestedAt[2]! - requestedAt[1]!).toBeGreaterThanOrEqual(900);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

  test("exhausts two automatic retries, preserves rows, then manually retries the exact cursor", async () => {
    controlPaginationClock();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length < 5) throw new Error("later page unavailable");
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    expect(view.getByTestId("continuing").textContent).toBe("true");
    await advanceContinuation(1_000);
    expect(queries).toHaveLength(3);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    await advanceContinuation(2_999);
    expect(queries).toHaveLength(3);
    await advanceContinuation(1);
    expect(queries).toHaveLength(4);
    await settleContinuation();
    expect(view.getByTestId("load-more-error").textContent).toBe("true");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    expect(view.getByTestId("continuing").textContent).toBe("false");
    fireEvent.click(view.getByText("sentinel visible"));
    expect(queries).toHaveLength(4);
    fireEvent.click(view.getByText("manual retry"));
    await advanceContinuation(0);
    await settleContinuation();
    expect(queries).toHaveLength(5);
    expect(view.getByTestId("cursor").textContent).toBe("end");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

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
    controlPaginationClock();
    const refetch = deferred<unknown>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      if (queries.length === 2) return refetch.promise;
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], null);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    fireEvent.click(view.getByText("refetch"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(queries).toHaveLength(2);
    await act(async () => { refetch.reject(new Error("background refetch unavailable")); await refetch.promise.catch(() => undefined); });
    await settleContinuation();
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    expect(view.getByTestId("continuing").textContent).toBe("true");
    await advanceContinuation(1_000);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("end");
    expect(cursors(queries)).toEqual([null, null, "cursor-1"]);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
  });

  test("bounds non-advancing cursor retries without losing earlier rows", async () => {
    controlPaginationClock();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        return page(query, WALLET_A, [transfer(query, WALLET_A, "event-30", "30")], "cursor-1");
      }
      return page(query, WALLET_A, [transfer(query, WALLET_A, "event-20", "20")], "cursor-1");
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await settleContinuation();
    expect(view.getByTestId("cursor").textContent).toBe("cursor-1");
    fireEvent.click(view.getByText("sentinel visible"));
    await settleContinuation();
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    await advanceContinuation(1_000);
    expect(queries).toHaveLength(3);
    expect(view.getByTestId("load-more-error").textContent).toBe("false");
    await advanceContinuation(2_999);
    expect(queries).toHaveLength(3);
    await advanceContinuation(1);
    await settleContinuation();
    expect(view.getByTestId("load-more-error").textContent).toBe("true");
    expect(cursors(queries)).toEqual([null, "cursor-1", "cursor-1", "cursor-1"]);
    expect(view.getByTestId("ids").textContent).toBe("event-30");
    expect(view.getByTestId("continuing").textContent).toBe("false");
  });

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

function recoveryWindow(owner: VerifiedAccountSession, prior: "healthy" | "partial" = "healthy") {
  const queryClient = getHomeQueryClient();
  const ownerKey = activityOwnerKey(owner);
  const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
  const windowEnd = initialActivityWindowEnd();
  const query = `to=${encodeURIComponent(windowEnd)}&currency=USD`;
  const current = prior === "partial" ? partialPage(query, owner.smartAccount!.address as typeof WALLET_A | typeof WALLET_B)
    : page(query, owner.smartAccount!.address as typeof WALLET_A | typeof WALLET_B, [], null);
  queryClient.setQueryData(windowKey, windowEnd);
  queryClient.setQueryData(ownerQueryKey(ownerKey, "activity", windowEnd, "USD"),
    { pages: [current], pageParams: [null] } satisfies InfiniteData<ActivityPage>);
  return { queryClient, ownerKey, windowKey, windowEnd };
}

async function flushRecovery() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
async function flushMountedRecovery() {
  await act(async () => {
    await flushRecovery();
    jest.advanceTimersByTime(1);
    await flushRecovery();
  });
}


async function advanceFirstPageRetry(delayMs: number) {
  jest.advanceTimersByTime(delayMs);
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

describe("mounted first-page recovery with an empty cache", () => {
  test.each(["ACTIVITY_UNAUTHORIZED", "ACTIVITY_INVALID_RESPONSE", "ACTIVITY_NOT_CONFIGURED"] as const)("does not retry transport HTTP 502 with wire code %s", async (code) => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const fetchActivity: FetchActivity = async () => {
      calls++;
      throw Object.assign(new ResourceFailure("http", undefined, 502), { code });
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("error");
    await act(async () => { await advanceFirstPageRetry(2_000); });
    expect(calls).toBe(1);
  });

  test.each(["ACTIVITY_UPSTREAM", "ACTIVITY_TIMEOUT"] as const)("retries transport HTTP 502 with wire code %s", async (code) => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const fetchActivity: FetchActivity = async () => {
      calls++;
      throw Object.assign(new ResourceFailure("http", undefined, 502), { code });
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(calls).toBe(1);
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    expect(calls).toBe(3);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("error");
  });

  test("cold start exhausted transient failures show an error after three requests", async () => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const fetchActivity: FetchActivity = async () => { calls++; throw new ResourceFailure("network"); };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("loading");
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    expect(calls).toBe(3);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("error");
  });

  test("cold start exhausted partial responses show card rows and unavailable onchain status", async () => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const fetchActivity: FetchActivity = async (query) => { calls++; return partialPage(query, WALLET_A, [cardPurchase]); };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("loading");
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    expect(calls).toBe(3);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("onchain-status").textContent).toBe("unavailable");
    expect(view.getByTestId("card-ids").textContent).toBe(cardPurchase.id);
  });

  test("manual retry retains mounted healthy transfers when three partial responses follow", async () => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const fetchActivity: FetchActivity = async (query) => {
      calls++;
      return calls === 1 ? page(query, WALLET_A, [transfer(query, WALLET_A, "kept", "30")], null)
        : partialPage(query, WALLET_A, [cardPurchase]);
    };
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    const queryClient = getHomeQueryClient();
    const ownerKey = activityOwnerKey(session("subject-a", WALLET_A));
    const windowEnd = queryClient.getQueryData<string>(ownerQueryKey(ownerKey, activityWindowScope))!;
    const currentKey = ownerQueryKey(ownerKey, "activity", windowEnd, "USD");
    const updatedAt = queryClient.getQueryState(currentKey)!.dataUpdatedAt;
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    expect(calls).toBe(4);
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(view.getByTestId("card-ids").textContent).toBe(cardPurchase.id);
    expect(queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(updatedAt);
  });
});

describe("after-action activity windows", () => {
  for (const requestKind of ["after-action", "pull"] as const) {
    test.each([0, 1, 2, 3, 4, 5, 6])(`services a ${requestKind} request after %s settling microtasks`, async (gap) => {
      jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
      const owner = session("subject-a", WALLET_A);
      const ownerKey = activityOwnerKey(owner);
      const queryClient = getHomeQueryClient();
      const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
      const firstLatest = deferred<ActivityResponse>();
      const nextLatest = deferred<ActivityResponse>();
      const queries: string[] = [];
      const fetchActivity: FetchActivity = (query) => {
        queries.push(query);
        if (queries.length === 2) return firstLatest.promise;
        if (queries.length === 3) return nextLatest.promise;
        return Promise.resolve(page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null));
      };
      const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
      await flushMountedRecovery();
      await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
      expect(queries).toHaveLength(2);
      const firstEnd = new URLSearchParams(queries[1]).get("to")!;
      const committedWindow = deferred<void>();
      const windowQuery = queryClient.getQueryCache().find({ queryKey: windowKey, exact: true });
      const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.query === windowQuery && event.query.state.data === firstEnd) committedWindow.resolve();
      });
      let pullOutcome = "pending";
      let pull: Promise<void> | undefined;
      await act(async () => {
        firstLatest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "first", "40"))], null));
        await committedWindow.promise;
        unsubscribe();
        for (let step = 0; step < gap; step += 1) await Promise.resolve();
        if (requestKind === "after-action") {
          void invalidateAfterAction(queryClient, ownerKey);
        } else {
          pull = refreshActivityThroughController({
            queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
            isCurrent: () => true, onPrefetchKey: () => {},
          }).then(() => { pullOutcome = "resolved"; }, () => { pullOutcome = "rejected"; });
        }
      });
      await flushMountedRecovery();
      expect(queries).toHaveLength(3);
      expect(pullOutcome).toBe("pending");
      const nextEnd = new URLSearchParams(queries[2]).get("to")!;
      expect(nextEnd).not.toBe(firstEnd);
      expect(queryClient.getQueryData<string>(windowKey)).toBe(firstEnd);
      await act(async () => {
        nextLatest.resolve(page(queries[2]!, WALLET_A, [priced(transfer(queries[2]!, WALLET_A, "latest", "60"))], null));
        await pull;
      });
      await flushMountedRecovery();
      expect(queries).toHaveLength(3);
      expect(queryClient.getQueryData<string>(windowKey)).toBe(nextEnd);
      expect(view.getByTestId("ids").textContent).toBe("latest");
      expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
      if (requestKind === "pull") expect(pullOutcome).toBe("resolved");
    });
  }

  test("services new-epoch action and pull requests before an abandoned read settles", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const oldLatest = deferred<ActivityResponse>();
    const newLatest = deferred<ActivityResponse>();
    const followupLatest = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = (query) => {
      queries.push(query);
      if (queries.length === 2) return oldLatest.promise;
      if (queries.length === 4) return newLatest.promise;
      if (queries.length === 5) return followupLatest.promise;
      return Promise.resolve(page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null));
    };
    const first = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const originalEnd = queryClient.getQueryData<string>(windowKey);
    const abandonedPull = refreshActivityThroughController({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    }).then(() => "resolved", () => "rejected");
    expect(queries).toHaveLength(2);
    first.unmount();
    const fallbackEnd = queryClient.getQueryData<string>(windowKey);
    expect(fallbackEnd).not.toBe(originalEnd);
    const remounted = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    let pullOutcome = "pending";
    void invalidateAfterAction(queryClient, ownerKey);
    const pull = refreshActivityThroughController({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    }).then(() => { pullOutcome = "resolved"; }, () => { pullOutcome = "rejected"; });
    await act(async () => {
      oldLatest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "old-latest", "40"))], null));
    });
    await flushMountedRecovery();
    expect(await abandonedPull).toBe("rejected");
    expect(queries).toHaveLength(4);
    expect(pullOutcome).toBe("pending");
    expect(queryClient.getQueryData<string>(windowKey)).toBe(fallbackEnd);
    expect(remounted.getByTestId("ids").textContent).toBe("kept");
    expect(remounted.getByTestId("latest-unavailable").textContent).toBe("false");
    await act(async () => {
      newLatest.resolve(page(queries[3]!, WALLET_A, [priced(transfer(queries[3]!, WALLET_A, "latest", "60"))], null));
    });
    await flushMountedRecovery();
    expect(pullOutcome).toBe("pending");
    expect(queries).toHaveLength(5);
    await act(async () => {
      followupLatest.resolve(page(queries[4]!, WALLET_A, [priced(transfer(queries[4]!, WALLET_A, "latest", "60"))], null));
      await pull;
    });
    await flushMountedRecovery();
    expect(pullOutcome).toBe("resolved");
    expect(queries).toHaveLength(5);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(new URLSearchParams(queries[4]).get("to")!);
    expect(remounted.getByTestId("ids").textContent).toBe("latest");
    expect(remounted.getByTestId("latest-unavailable").textContent).toBe("false");
  });

  test.each([
    ["failure", "success"], ["timeout", "success"],
    ["failure", "failure"], ["timeout", "failure"],
  ] as const)("reruns from an older pull's committed baseline after %s, with a %s rerun", async (failure, outcome) => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const pull = deferred<ActivityResponse>();
    const afterAction = deferred<ActivityResponse>();
    const rerun = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 2) return pull.promise;
      if (queries.length === 3) return afterAction.promise;
      if (queries.length === 4) return rerun.promise;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const pullRead = refreshLatestActivity({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    });
    await act(async () => { jest.advanceTimersByTime(2_000); });
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    expect(queries).toHaveLength(3);
    await act(async () => {
      pull.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "pulled", "40"))], null));
      expect(await pullRead).toBe("advanced");
    });
    await flushMountedRecovery();
    const pullEnd = new URLSearchParams(queries[1]).get("to")!;
    await act(async () => {
      if (failure === "failure") afterAction.reject(new Error("Latest unavailable"));
      else await advanceFirstPageRetry(45_000);
    });
    await flushMountedRecovery();
    expect(queries).toHaveLength(4);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(pullEnd);
    expect(view.getByTestId("ids").textContent).toBe("pulled");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    const finalEnd = new URLSearchParams(queries[3]).get("to")!;
    expect(Date.parse(finalEnd)).toBeGreaterThan(Date.parse(pullEnd));
    await act(async () => {
      if (outcome === "success") rerun.resolve(page(queries[3]!, WALLET_A, [priced(transfer(queries[3]!, WALLET_A, "latest", "60"))], null));
      else rerun.reject(new Error("Current latest unavailable"));
    });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(outcome === "success" ? finalEnd : pullEnd);
    expect(view.getByTestId("ids").textContent).toBe(outcome === "success" ? "latest" : "pulled");
    expect(view.getByTestId("latest-unavailable").textContent).toBe(String(outcome === "failure"));
    if (failure === "timeout") {
      await act(async () => { afterAction.resolve(page(queries[2]!, WALLET_A, [], null)); });
      await flushMountedRecovery();
      expect(view.getByTestId("latest-unavailable").textContent).toBe(String(outcome === "failure"));
    }
  });

  test("a cancelled epoch cannot publish a latest failure after the owner boundary is cleared and remounted", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let signal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, readSignal) => {
      queries.push(query);
      if (queries.length === 2) { signal = readSignal; return latest.promise; }
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "healthy-a", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const originalEnd = queryClient.getQueryData<string>(windowKey)!;
    const pending = refreshActivityThroughController({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    }).then(() => "resolved", () => "rejected");
    const otherOwner = session("subject-b", WALLET_B);
    const fetchOther: FetchActivity = async (query) => page(query, WALLET_B, [], null);
    view.rerender(<HookHarness owner={otherOwner} fetchActivity={fetchOther} />);
    clearOwnerQueryBoundary(queryClient, undefined, activityOwnerKey(otherOwner));
    view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    expect(signal?.aborted).toBe(true);
    await flushMountedRecovery();
    expect(await pending).toBe("rejected");
    expect(queryClient.getQueryData<string>(windowKey)).toBe(originalEnd);
    expect(view.getByTestId("ids").textContent).toBe("healthy-a");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    await act(async () => { latest.reject(new Error("Cancelled latest unavailable")); });
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });

  test("a controller pull rejects on timeout while retaining the current rows", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const latest = deferred<ActivityResponse>();
    let reads = 0;
    const fetchActivity: FetchActivity = async (query) => {
      if (++reads === 2) return latest.promise;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const pending = refreshActivityThroughController({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    }).then(() => "resolved", () => "rejected");
    await act(async () => { await advanceFirstPageRetry(45_000); });
    await flushMountedRecovery();
    expect(await pending).toBe("rejected");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    latest.resolve(page("to=2026-09-28T12%3A00%3A00.000Z", WALLET_A, [], null));
  });

  test.each(["non-transient", "transient", "partial"] as const)("retains loaded rows after a %s latest read and retries the new window", async (failure) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const ownerKey = activityOwnerKey(owner);
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const queries: string[] = [];
    let fail = true;
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length > 1 && fail) {
        if (failure === "partial") return partialPage(query, WALLET_A, [cardPurchase]);
        throw failure === "transient" ? new ResourceFailure("network") : new Error("Latest unavailable");
      }
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, queries.length === 1 ? "kept" : "latest", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(view.getByTestId("ids").textContent).toBe("kept");
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    const pending = invalidateAfterAction(queryClient, ownerKey);
    await flushMountedRecovery();
    if (failure !== "non-transient") {
      for (const delay of activityFirstPageRetryDelaysMs) {
        await act(async () => { await advanceFirstPageRetry(delay); });
      }
    }
    await pending;
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(view.getByTestId("card-ids").textContent).toBe("");
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    const attemptedEnd = new URLSearchParams(queries[1]).get("to")!;
    expect(queryClient.getQueryCache().find({ queryKey: ownerQueryKey(ownerKey, "activity", attemptedEnd, "USD"), exact: true })).toBeUndefined();
    fail = false;
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    expect(queryClient.getQueryData(windowKey)).not.toBe(windowEnd);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    expect(new URLSearchParams(queries.at(-1)).get("to")).not.toBe(windowEnd);
  });

  test("advances only after a healthy latest read while keeping rows ready in flight", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      return queries.length === 1 ? page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null) : latest.promise;
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    const pending = invalidateAfterAction(queryClient, ownerKey);
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "latest", "40"))], null));
      await pending;
    });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(new URLSearchParams(queries[1]).get("to")!);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    expect(queries).toHaveLength(2);
  });

  test("reports transfers loading for a hook mounted during an in-flight latest-window read", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      return queries.length === 1 ? page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null) : latest.promise;
    };
    const current = renderHook(() => useActivity(owner, fetchActivity));
    await flushMountedRecovery();
    expect(current.result.current.status).toBe("ready");
    expect(current.result.current.refreshing).toBe(false);
    expect(transfersReadiness(current.result.current)).toBe("ready");
    await act(async () => { await invalidateAfterAction(queryClient, activityOwnerKey(owner)); });
    await flushMountedRecovery();
    expect(queries).toHaveLength(2);
    const mounted = renderHook(() => useActivity(owner, fetchActivity));
    expect(current.result.current.refreshing).toBe(true);
    expect(mounted.result.current.status).toBe("ready");
    expect(mounted.result.current.refreshing).toBe(true);
    expect(transfersReadiness(mounted.result.current)).toBe("loading");
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [
        priced(transfer(queries[1]!, WALLET_A, "new", "40")),
        priced(transfer(queries[1]!, WALLET_A, "kept", "30")),
      ], null));
      await latest.promise;
    });
    await flushMountedRecovery();
    expect(current.result.current.refreshing).toBe(false);
    expect(mounted.result.current.refreshing).toBe(false);
    expect(transfersReadiness(mounted.result.current)).toBe("ready");
    expect(queries).toHaveLength(2);
  });

  test("reruns a superseded after-action read from the window committed by an earlier pull-to-refresh", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const pull = deferred<ActivityResponse>();
    const afterAction = deferred<ActivityResponse>();
    const rerun = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 2) return pull.promise;
      if (queries.length === 3) return afterAction.promise;
      if (queries.length === 4) return rerun.promise;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const pullRead = refreshLatestActivity({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity,
      isCurrent: () => true, onPrefetchKey: () => {},
    });
    await act(async () => { jest.advanceTimersByTime(2_000); });
    const actionCutoff = Date.now();
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    expect(queries).toHaveLength(3);
    await act(async () => {
      pull.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "pulled", "40"))], null));
      expect(await pullRead).toBe("advanced");
    });
    await flushMountedRecovery();
    const pullEnd = new URLSearchParams(queries[1]).get("to")!;
    expect(queryClient.getQueryData<string>(windowKey)).toBe(pullEnd);
    expect(Date.parse(pullEnd)).toBeLessThan(actionCutoff);
    await act(async () => {
      afterAction.resolve(page(queries[2]!, WALLET_A, [priced(transfer(queries[2]!, WALLET_A, "first-action-read", "50"))], null));
    });
    await flushMountedRecovery();
    expect(queries).toHaveLength(4);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(pullEnd);
    expect(view.getByTestId("ids").textContent).toBe("pulled");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    const finalEnd = new URLSearchParams(queries[3]).get("to")!;
    expect(Date.parse(finalEnd)).toBeGreaterThan(actionCutoff);
    await act(async () => {
      rerun.resolve(page(queries[3]!, WALLET_A, [priced(transfer(queries[3]!, WALLET_A, "latest", "60"))], null));
    });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(finalEnd);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });

  test("times out a hung latest read, allows a later action, and ignores the original late response", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const hung = deferred<ActivityResponse>();
    const recovered = deferred<ActivityResponse>();
    const queries: string[] = [];
    let hungSignal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, signal) => {
      queries.push(query);
      if (queries.length === 2) { hungSignal = signal; return hung.promise; }
      if (queries.length === 3) return recovered.promise;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    const prefetchKey = ownerQueryKey(ownerKey, "activity", new URLSearchParams(queries[1]).get("to")!, "USD");
    await act(async () => { await advanceFirstPageRetry(activityLatestReadTimeoutMs - 1); });
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    expect(hungSignal?.aborted).toBe(false);
    await act(async () => { await advanceFirstPageRetry(1); });
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    expect(hungSignal?.aborted).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: prefetchKey, exact: true })).toBeUndefined();
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    expect(queries).toHaveLength(3);
    await act(async () => {
      recovered.resolve(page(queries[2]!, WALLET_A, [priced(transfer(queries[2]!, WALLET_A, "latest", "40"))], null));
    });
    await flushMountedRecovery();
    const advancedEnd = queryClient.getQueryData<string>(windowKey)!;
    expect(advancedEnd).toBe(new URLSearchParams(queries[2]).get("to")!);
    expect(advancedEnd).not.toBe(windowEnd);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    await act(async () => {
      hung.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "late-original", "50"))], null));
    });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(advancedEnd);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    await act(async () => { await advanceFirstPageRetry(activityLatestReadTimeoutMs); });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(advancedEnd);
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });

  test("a new session object for the same owner does not abandon an in-flight latest read", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let signal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, readSignal) => {
      queries.push(query);
      if (queries.length === 2) { signal = readSignal; return latest.promise; }
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const pending = invalidateAfterAction(queryClient, ownerKey);
    await flushMountedRecovery();
    view.rerender(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "latest", "40"))], null));
      await pending;
    });
    await flushMountedRecovery();
    expect(signal?.aborted).toBe(false);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(new URLSearchParams(queries[1]).get("to")!);
    expect(view.getByTestId("ids").textContent).toBe("latest");
  });


  test.each(["owner-change", "sign-out", "unmount"] as const)("cancels the old owner's prefetch and advances without a view on %s", async (change) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let signal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, readSignal) => {
      queries.push(query);
      if (queries.length === 2) { signal = readSignal; return latest.promise; }
      const wallet = queries.length === 1 ? WALLET_A : WALLET_B;
      return page(query, wallet, [priced(transfer(query, wallet, queries.length === 1 ? "old-owner" : "new-owner", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    const pending = invalidateAfterAction(queryClient, ownerKey);
    await flushMountedRecovery();
    if (change === "unmount") view.unmount();
    else view.rerender(<HookHarness owner={change === "sign-out" ? null : session("subject-b", WALLET_B)} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "late-old-owner", "40"))], null));
      await pending;
    });
    await flushMountedRecovery();
    expect(signal?.aborted).toBe(true);
    expect(queryClient.getQueryData<string>(windowKey)).not.toBe(windowEnd);
    expect(queryClient.getQueryCache().find({ queryKey: ownerQueryKey(ownerKey, "activity", new URLSearchParams(queries[1]).get("to")!, "USD"), exact: true })).toBeUndefined();
    if (change === "owner-change") {
      expect(view.getByTestId("ids").textContent).toBe("new-owner");
      expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    } else if (change === "sign-out") expect(view.getByTestId("status").textContent).toBe("unavailable");
  });

  test.each(["sign-out", "owner-switch"] as const)("clears a latest failure across a same-minute %s and return", async (change) => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    let fail = false;
    const fetchActivity: FetchActivity = async (query) => {
      if (fail) throw new Error("Latest unavailable");
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "healthy-a", "30"))], null);
    };
    const fetchOther: FetchActivity = async (query) => page(query, WALLET_B, [priced(transfer(query, WALLET_B, "healthy-b", "30"))], null);
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const failedWindow = queryClient.getQueryData<string>(windowKey)!;
    fail = true;
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    fail = false;
    view.rerender(<HookHarness owner={change === "sign-out" ? null : session("subject-b", WALLET_B)} fetchActivity={fetchOther} />);
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).not.toBe(failedWindow);
    expect(queryClient.getQueryCache().findAll({ queryKey: ownerQueryKey(ownerKey, "activity") }).every((query) => query.state.isInvalidated)).toBe(true);
    if (change === "sign-out") expect(view.getByTestId("status").textContent).toBe("unavailable");
    else expect(view.getByTestId("ids").textContent).toBe("healthy-b");
    queryClient.removeQueries({ queryKey: [ownerKey] });
    view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(failedWindow);
    expect(view.getByTestId("ids").textContent).toBe("healthy-a");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });

  test("two consumers share latest failures and a retry from either advances both with one read", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(activityOwnerKey(owner), activityWindowScope);
    const queries: string[] = [];
    let fail = false;
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (fail) throw new Error("Latest unavailable");
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, queries.length === 1 ? "kept" : "latest", "30"))], null);
    };
    const view = render(
      <>
        <HookHarness owner={owner} fetchActivity={fetchActivity} testId="first-" />
        <HookHarness owner={owner} fetchActivity={fetchActivity} testId="second-" />
      </>,
    );
    await flushMountedRecovery();
    expect(queries).toHaveLength(1);
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    fail = true;
    await act(async () => { await invalidateAfterAction(queryClient, activityOwnerKey(owner)); });
    await flushMountedRecovery();
    expect(queries).toHaveLength(2);
    for (const testId of ["first-", "second-"]) {
      expect(view.getByTestId(`${testId}status`).textContent).toBe("ready");
      expect(view.getByTestId(`${testId}ids`).textContent).toBe("kept");
      expect(view.getByTestId(`${testId}latest-unavailable`).textContent).toBe("true");
    }
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    fail = false;
    fireEvent.click(view.getByTestId("second-refetch"));
    await flushMountedRecovery();
    expect(queries).toHaveLength(3);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(new URLSearchParams(queries[2]).get("to")!);
    for (const testId of ["first-", "second-"]) {
      expect(view.getByTestId(`${testId}ids`).textContent).toBe("latest");
      expect(view.getByTestId(`${testId}latest-unavailable`).textContent).toBe("false");
    }
  });

  test.each([true, false])("a remounted consumer retains the latest failure only with a survivor: %s", async (survivor) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    let fail = false;
    const fetchActivity: FetchActivity = async (query) => {
      if (fail) throw new Error("Latest unavailable");
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const first = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="first-" />);
    if (survivor) render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="second-" />);
    await flushMountedRecovery();
    fail = true;
    await act(async () => { await invalidateAfterAction(getHomeQueryClient(), activityOwnerKey(owner)); });
    await flushMountedRecovery();
    expect(first.getByTestId("first-latest-unavailable").textContent).toBe("true");
    fail = false;
    first.unmount();
    const remounted = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="remounted-" />);
    await flushMountedRecovery();
    expect(remounted.getByTestId("remounted-status").textContent).toBe("ready");
    expect(remounted.getByTestId("remounted-ids").textContent).toBe("kept");
    expect(remounted.getByTestId("remounted-latest-unavailable").textContent).toBe(String(survivor));
    if (survivor) expect(remounted.getByTestId("second-latest-unavailable").textContent).toBe("true");
  });

  test("a latest read survives the first observer unmounting and advances the survivor", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(activityOwnerKey(owner), activityWindowScope);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let signal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, readSignal) => {
      queries.push(query);
      if (queries.length === 2) { signal = readSignal; return latest.promise; }
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const first = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="first-" />);
    const second = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="second-" />);
    await flushMountedRecovery();
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    await act(async () => { await invalidateAfterAction(queryClient, activityOwnerKey(owner)); });
    await flushMountedRecovery();
    first.unmount();
    expect(signal?.aborted).toBe(false);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "latest", "40"))], null));
    });
    await flushMountedRecovery();
    expect(signal?.aborted).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(new URLSearchParams(queries[1]).get("to")!);
    expect(second.getByTestId("second-ids").textContent).toBe("latest");
    expect(second.getByTestId("second-latest-unavailable").textContent).toBe("false");
  });

  test("the last observer unmounting mid-read directly advances and removes a nonlive prefetch", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const ownerKey = activityOwnerKey(owner);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let signal: AbortSignal | undefined;
    const fetchActivity: FetchActivity = async (query, readSignal) => {
      queries.push(query);
      if (queries.length === 2) { signal = readSignal; return latest.promise; }
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "kept", "30"))], null);
    };
    const first = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="first-" />);
    const second = render(<HookHarness owner={owner} fetchActivity={fetchActivity} testId="second-" />);
    await flushMountedRecovery();
    const windowEnd = queryClient.getQueryData<string>(windowKey)!;
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    await flushMountedRecovery();
    const prefetchKey = ownerQueryKey(ownerKey, "activity", new URLSearchParams(queries[1]).get("to")!, "USD");
    expect(queryClient.getQueryCache().find({ queryKey: prefetchKey, exact: true })).toBeDefined();
    first.unmount();
    expect(signal?.aborted).toBe(false);
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    second.unmount();
    const advancedEnd = queryClient.getQueryData<string>(windowKey)!;
    expect(advancedEnd).not.toBe(windowEnd);
    expect(advancedEnd).not.toBe(prefetchKey[2]);
    expect(signal?.aborted).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: prefetchKey, exact: true })).toBeUndefined();
    await act(async () => { latest.resolve(page(queries[1]!, WALLET_A, [], null)); });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(advancedEnd);
  });

  test.each(["success", "failure"] as const)("a currency change during a latest read waits for the new currency: %s", async (outcome) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const windowKey = ownerQueryKey(activityOwnerKey(owner), activityWindowScope);
    const usdLatest = deferred<ActivityResponse>();
    const eurLatest = deferred<ActivityResponse>();
    const queries: string[] = [];
    let windowEnd = "";
    const response = (query: string, id: string) => {
      const row = transfer(query, WALLET_A, id, "30");
      row.valuation = { status: "unpriced", currency: new URLSearchParams(query).get("currency") as ActivityPage["currency"], reason: "unknown-token" };
      return page(query, WALLET_A, [row], null);
    };
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      const params = new URLSearchParams(query);
      if (windowEnd && params.get("to") !== windowEnd) {
        return params.get("currency") === "USD" ? usdLatest.promise : eurLatest.promise;
      }
      return response(query, params.get("currency") === "USD" ? "usd-kept" : "eur-kept");
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    windowEnd = queryClient.getQueryData<string>(windowKey)!;
    await act(async () => { await invalidateAfterAction(queryClient, activityOwnerKey(owner)); });
    await flushMountedRecovery();
    expect(queries).toHaveLength(2);
    view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} regionId="DE" />);
    await flushMountedRecovery();
    expect(view.getByTestId("ids").textContent).toBe("eur-kept");
    await act(async () => { usdLatest.resolve(response(queries[1]!, "usd-latest")); });
    await flushMountedRecovery();
    expect(queryClient.getQueryData<string>(windowKey)).toBe(windowEnd);
    expect(queries).toHaveLength(4);
    expect(new URLSearchParams(queries[3]).get("currency")).toBe("EUR");
    expect(new URLSearchParams(queries[3]).get("to")).not.toBe(windowEnd);
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    await act(async () => {
      if (outcome === "success") eurLatest.resolve(response(queries[3]!, "eur-latest"));
      else eurLatest.reject(new Error("EUR latest unavailable"));
    });
    await flushMountedRecovery();
    expect(queries).toHaveLength(4);
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("currency").textContent).toBe("EUR");
    expect(view.getByTestId("ids").textContent).toBe(outcome === "success" ? "eur-latest" : "eur-kept");
    expect(view.getByTestId("latest-unavailable").textContent).toBe(String(outcome === "failure"));
    expect(queryClient.getQueryData<string>(windowKey)).toBe(outcome === "success" ? new URLSearchParams(queries[3]).get("to")! : windowEnd);
  });

  test("coalesces actions during an in-flight read into exactly one additional run", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 2) return latest.promise;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, queries.length === 1 ? "kept" : "second-action", "30"))], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    const first = invalidateAfterAction(queryClient, activityOwnerKey(owner));
    await flushMountedRecovery();
    const second = invalidateAfterAction(queryClient, activityOwnerKey(owner));
    const third = invalidateAfterAction(queryClient, activityOwnerKey(owner));
    expect(queries).toHaveLength(2);
    await act(async () => {
      latest.resolve(page(queries[1]!, WALLET_A, [priced(transfer(queries[1]!, WALLET_A, "first-action", "30"))], null));
      await Promise.all([first, second, third]);
    });
    await flushMountedRecovery();
    expect(queries).toHaveLength(3);
    expect(view.getByTestId("ids").textContent).toBe("second-action");
    expect(new URLSearchParams(queries[2]).get("to")).not.toBe(new URLSearchParams(queries[1]).get("to"));
  });

  test("a window or currency change hides a scoped latest failure", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const queryClient = getHomeQueryClient();
    const ownerKey = activityOwnerKey(owner);
    let fail = false;
    const fetchActivity: FetchActivity = async (query) => {
      if (fail) throw new Error("Latest unavailable");
      const row = priced(transfer(query, WALLET_A, "kept", "30"));
      row.valuation = { status: "unpriced", currency: new URLSearchParams(query).get("currency") as ActivityPage["currency"], reason: "unknown-token" };
      return page(query, WALLET_A, [row], null);
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    fail = true;
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    fail = false;
    view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} regionId="DE" />);
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
    fail = true;
    await act(async () => { await invalidateAfterAction(queryClient, ownerKey); });
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("true");
    fail = false;
    await act(async () => {
      const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
      queryClient.setQueryData(windowKey, nextActivityWindowEnd(queryClient.getQueryData<string>(windowKey)));
    });
    await flushMountedRecovery();
    await flushMountedRecovery();
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });
});

describe("latest activity currency round trips", () => {
  test.each([0, 2, 4, 8])("a pull skipped by a currency round trip reruns before it resolves (gap %i)", async (gap) => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:10.000Z") });
    const owner = session(`currency-round-trip-${gap}`, WALLET_A);
    const queryClient = getHomeQueryClient();
    const ownerKey = activityOwnerKey(owner);
    const windowKey = ownerQueryKey(ownerKey, activityWindowScope);
    const queries: string[] = [];
    const latest = deferred<ActivityResponse>();
    let originalEnd = "";
    const response = (query: string, id: string) => {
      const row = transfer(query, WALLET_A, id, "30");
      row.valuation = { status: "unpriced", currency: new URLSearchParams(query).get("currency") as ActivityPage["currency"], reason: "unknown-token" };
      return page(query, WALLET_A, [row], null);
    };
    const fetchActivity: FetchActivity = (query) => {
      queries.push(query);
      if (queries.length === 2) return latest.promise;
      return Promise.resolve(response(query, originalEnd && new URLSearchParams(query).get("to") !== originalEnd ? "latest" : "kept"));
    };
    const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
    await flushMountedRecovery();
    originalEnd = queryClient.getQueryData<string>(windowKey)!;
    let outcome = "pending";
    const pull = refreshActivityThroughController({
      queryClient, ownerKey, session: owner, regionId: "GLOBAL", fetchActivity, isCurrent: () => true, onPrefetchKey: () => {},
    }).then(() => { outcome = "success"; }, () => { outcome = "failure"; });
    view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} regionId="DE" />);
    await flushMountedRecovery();
    await act(async () => {
      latest.resolve(response(queries[1]!, "latest"));
      for (let index = 0; index < gap; index += 1) await Promise.resolve();
      view.rerender(<HookHarness owner={owner} fetchActivity={fetchActivity} regionId="GLOBAL" />);
    });
    await flushMountedRecovery();
    await act(async () => { await pull; });
    await flushMountedRecovery();
    expect(outcome).toBe("success");
    expect(queryClient.getQueryData<string>(windowKey)).not.toBe(originalEnd);
    expect(view.getByTestId("ids").textContent).toBe("latest");
    expect(view.getByTestId("latest-unavailable").textContent).toBe("false");
  });
});

describe("latest activity concurrent windows", () => {
  test.each(["never-mounted", "unmounted"] as const)("controller refresh uses fallback prefetch ownership with a %s view", async (viewState) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const prefetchKeys: unknown[] = [];
    let reads = 0;
    const fetchActivity: FetchActivity = async (query) => {
      reads++;
      return page(query, WALLET_A, [priced(transfer(query, WALLET_A, "latest", "40"))], null);
    };
    if (viewState === "unmounted") {
      const view = render(<HookHarness owner={owner} fetchActivity={fetchActivity} />);
      await flushMountedRecovery();
      view.unmount();
    }
    await refreshActivityThroughController({
      ...scope, session: owner, regionId: "GLOBAL", fetchActivity, isCurrent: () => true,
      onPrefetchKey: (key) => { prefetchKeys.push(key); },
    });
    expect(reads).toBe(1);
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    expect(nextEnd).not.toBe(scope.windowEnd);
    expect(prefetchKeys).toEqual([ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"), null]);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"))?.pages[0]?.transfers[0]?.logId).toBe("latest");
  });

  test("controller fallback preserves isCurrent and skips when no current rows or view exist", async () => {
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    let reads = 0;
    const prefetchKeys: unknown[] = [];
    const input = {
      ...scope, session: owner, regionId: "GLOBAL" as const,
      fetchActivity: async () => { reads++; throw new Error("Unexpected activity read"); },
      onPrefetchKey: (key: unknown) => { prefetchKeys.push(key); },
    };
    await refreshActivityThroughController({ ...input, isCurrent: () => false });
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
    scope.queryClient.removeQueries({ queryKey: ownerQueryKey(scope.ownerKey, "activity") });
    await refreshActivityThroughController({ ...input, isCurrent: () => true });
    expect(reads).toBe(0);
    expect(prefetchKeys).toEqual([]);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
  });

  test("same-millisecond refreshes retain the newly live query on window mismatch", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const latest = deferred<ActivityResponse>();
    const queries: string[] = [];
    const input = { ...scope, session: owner, regionId: "GLOBAL" as const,
      fetchActivity: async (query: string) => { queries.push(query); return latest.promise; },
      isCurrent: () => true, onPrefetchKey: () => {} };
    const first = refreshLatestActivity(input);
    const second = refreshLatestActivity(input);
    expect(queries).toHaveLength(1);
    latest.resolve(page(queries[0]!, WALLET_A, [priced(transfer(queries[0]!, WALLET_A, "latest", "30"))], null));
    expect(await Promise.all([first, second])).toEqual(["advanced", "superseded"]);
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    expect(nextEnd).not.toBe(scope.windowEnd);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"))?.pages[0]?.transfers[0]?.logId).toBe("latest");
  });

  test("a failed refresh does not cancel or remove a next key that became live", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const latest = deferred<ActivityResponse>();
    let query = "";
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (request) => { query = request; return latest.promise; },
      isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    const nextEnd = new URLSearchParams(query).get("to")!;
    const nextKey = ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD");
    scope.queryClient.setQueryData(nextKey, { pages: [page(query, WALLET_A, [priced(transfer(query, WALLET_A, "live", "30"))], null)], pageParams: [null] });
    scope.queryClient.setQueryData(scope.windowKey, nextEnd);
    latest.reject(new Error("Read failed"));
    expect(await pending).toBeInstanceOf(Error);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(nextKey)?.pages[0]?.transfers[0]?.logId).toBe("live");
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(nextEnd);
  });
});

describe("first-page onchain recovery", () => {
  test("retries transient first-page failures after 500 ms and recovers without a partial warning", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-09-28T12:00:00.000Z") });
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner, "partial");
    const calls: number[] = [];
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => {
        calls.push(Date.now());
        if (calls.length === 1) throw new ResourceFailure("network");
        return page(query, WALLET_A, [transfer(query, WALLET_A, "recovered", "30")], null);
      }, isCurrent: () => true, onPrefetchKey: () => {} });
    await flushRecovery();
    expect(calls).toHaveLength(1);
    await advanceFirstPageRetry(499);
    expect(calls).toHaveLength(1);
    await advanceFirstPageRetry(1);
    await pending;
    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(500);
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    const next = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"));
    expect(next?.pages[0]?.transfers[0]?.logId).toBe("recovered");
    expect(next?.pages[0]?.onchainStatus).toBeUndefined();
  });

  for (const status of [429, 503]) test(`exhausts two transient first-page retries for HTTP ${status} and preserves the original error`, async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner, "partial");
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async () => { calls++; throw new ResourceFailure("http", "provider unavailable", status); },
      isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    const error = await pending;
    expect(error).toBeInstanceOf(ResourceFailure);
    expect((error as ResourceFailure).status).toBe(status);
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
  });

  test("retries an initial partial and replaces it with healthy history", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner, "partial");
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => ++calls === 1 ? partialPage(query, WALLET_A)
        : page(query, WALLET_A, [transfer(query, WALLET_A, "restored", "30")], null),
      isCurrent: () => true, onPrefetchKey: () => {} });
    await flushRecovery();
    await advanceFirstPageRetry(500);
    await pending;
    expect(calls).toBe(2);
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"))?.pages[0]?.onchainStatus).toBeUndefined();
  });

  test("after two retries a partial first page remains available when there is no healthy history", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner, "partial");
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => { calls++; return partialPage(query, WALLET_A); },
      isCurrent: () => true, onPrefetchKey: () => {} });
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    await pending;
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"))?.pages[0]?.onchainStatus).toBe("unavailable");
  });

  test.each(["parse", "http-400", "session", "access"] as const)("does not retry a %s first-page failure", async (failure) => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async () => {
        calls++;
        if (failure === "parse") return { invalid: true };
        throw failure === "http-400" ? new ResourceFailure("http", "bad request", 400) : new ResourceFailure(failure);
      }, isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    await advanceFirstPageRetry(2_000);
    expect(await pending).toBeInstanceOf(Error);
    expect(calls).toBe(1);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
  });

  test("healthy history is retained when a partial background refresh exhausts retries", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    scope.queryClient.setQueryData<InfiniteData<ActivityPage>>(currentKey, (old) => old && {
      ...old, pages: [{ ...old.pages[0]!, cards: { status: "ready", rows: [{ ...cardPurchase, id: "ipi_cached" }] } }],
    });
    const updatedAt = scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt;
    const current = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    const prefetchedKeys: QueryKey[] = [];
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => { calls++; return partialPage(query, WALLET_A, [cardPurchase]); },
      isCurrent: () => true, onPrefetchKey: (key) => { if (key) prefetchedKeys.push(key); } }).catch((error: unknown) => error);
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    expect((await pending as Error).message).toBe("Activity onchain history is unavailable.");
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)).toBe(current);
    expect(current.pages[0]?.cards?.rows.map((row) => row.id)).toEqual(["ipi_cached"]);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(updatedAt);
    expect(prefetchedKeys).toHaveLength(1);
    expect(scope.queryClient.getQueryState(prefetchedKeys[0]!)).toBeUndefined();
  });

  test("abort during the retry delay stops further first-page requests", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    let calls = 0;
    let signal: AbortSignal | undefined;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (_query, currentSignal) => { calls++; signal = currentSignal; throw new ResourceFailure("network"); },
      isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    expect(calls).toBe(1);
    await scope.queryClient.cancelQueries({ queryKey: [scope.ownerKey, "activity"] });
    await advanceFirstPageRetry(2_000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  test("healthy history stays intact after exhausted transient background failures", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    const current = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    current.pages[0]!.transfers = [transfer(`to=${encodeURIComponent(scope.windowEnd)}&currency=USD`, WALLET_A, "kept", "30")];
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async () => { calls++; throw new ResourceFailure("network"); },
      isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    expect(await pending).toBeInstanceOf(ResourceFailure);
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)?.pages[0]?.transfers[0]?.logId).toBe("kept");
  });

  test("a healthy manual refresh replaces partial history", async () => {
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner, "partial");
    await refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => page(query, WALLET_A, [transfer(query, WALLET_A, "recovered", "30")], null),
      isCurrent: () => true, onPrefetchKey: () => {} });
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    const next = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"));
    expect(next?.pages[0]?.transfers[0]?.logId).toBe("recovered");
    expect(next?.pages[0]?.onchainStatus).toBeUndefined();
  });

  test("healthy history for another owner never suppresses a partial first page", async () => {
    jest.useFakeTimers();
    recoveryWindow(session("subject-a", WALLET_A));
    const owner = session("subject-b", WALLET_B);
    const scope = recoveryWindow(owner, "partial");
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => { calls++; return partialPage(query, WALLET_B); },
      isCurrent: () => true, onPrefetchKey: () => {} });
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    await pending;
    const nextEnd = scope.queryClient.getQueryData<string>(scope.windowKey)!;
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", nextEnd, "USD"))?.pages[0]?.onchainStatus).toBe("unavailable");
  });

  test("a cursor-page failure never uses the first-page retry budget", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const query = `to=${encodeURIComponent(scope.windowEnd)}&currency=USD`;
    scope.queryClient.setQueryData(ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD"), {
      pages: [page(query, WALLET_A, [transfer(query, WALLET_A, "newer", "30")], "cursor-1"),
        page(query, WALLET_A, [transfer(query, WALLET_A, "older", "20")], null)],
      pageParams: [null, "cursor-1"],
    } satisfies InfiniteData<ActivityPage>);
    const queries: string[] = [];
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (request) => {
        queries.push(request);
        if (new URLSearchParams(request).has("cursor")) throw new ResourceFailure("http", "bad request", 400);
        return page(request, WALLET_A, [transfer(request, WALLET_A, "newer", "30")], "cursor-1");
      }, isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    expect(await pending).toBeInstanceOf(ResourceFailure);
    expect(cursors(queries)).toEqual([null, "cursor-1"]);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
  });
});

describe("mounted same-window card retention", () => {
  test("a fresh partial replaces cached card statuses and drops absent rows without renewing stale timing", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    const query = `to=${encodeURIComponent(scope.windowEnd)}&currency=USD`;
    const cachedCards = { status: "ready" as const, rows: [
      { ...cardPurchase, status: "pending" as const }, { ...cardPurchase, id: "ipi_absent" },
    ] };
    scope.queryClient.setQueryData(currentKey, {
      pages: [{ ...page(query, WALLET_A, [transfer(query, WALLET_A, "kept", "30")], null), cards: cachedCards }],
      pageParams: [null],
    } satisfies InfiniteData<ActivityPage>);
    const current = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    const updatedAt = scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt;
    let calls = 0;
    const view = render(<HookHarness owner={owner} fetchActivity={async (request) => {
      calls++;
      return partialPage(request, WALLET_A, [cardPurchase]);
    }} />);
    await flushMountedRecovery();
    expect(view.getByTestId("card-ids").textContent).toBe(`${cardPurchase.id},ipi_absent`);
    expect(view.getByTestId("card-statuses").textContent).toBe("pending,completed");
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    await flushMountedRecovery();
    expect(calls).toBe(3);
    expect(view.getByTestId("card-ids").textContent).toBe(cardPurchase.id);
    expect(view.getByTestId("card-statuses").textContent).toBe("completed");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(updatedAt);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
    expect(current.pages[0]!.cards).toEqual(cachedCards);
  });

  test("a partial before the final transient failure still replaces same-window cards", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    const query = `to=${encodeURIComponent(scope.windowEnd)}&currency=USD`;
    scope.queryClient.setQueryData(currentKey, {
      pages: [{ ...page(query, WALLET_A, [transfer(query, WALLET_A, "kept", "30")], null),
        cards: { status: "ready", rows: [{ ...cardPurchase, status: "pending" }] } }],
      pageParams: [null],
    } satisfies InfiniteData<ActivityPage>);
    const updatedAt = scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt;
    let calls = 0;
    const view = render(<HookHarness owner={owner} fetchActivity={async (request) => {
      calls++;
      if (calls === 1) return partialPage(request, WALLET_A, [cardPurchase]);
      throw new ResourceFailure("network");
    }} />);
    await flushMountedRecovery();
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    await flushMountedRecovery();
    expect(calls).toBe(3);
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("card-ids").textContent).toBe(cardPurchase.id);
    expect(view.getByTestId("card-statuses").textContent).toBe("completed");
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(updatedAt);
  });

  test("a card-only write after the partial is not overwritten when later retries reject", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    const query = `to=${encodeURIComponent(scope.windowEnd)}&currency=USD`;
    scope.queryClient.setQueryData(currentKey, {
      pages: [{ ...page(query, WALLET_A, [transfer(query, WALLET_A, "kept", "30")], null),
        cards: { status: "ready", rows: [{ ...cardPurchase, status: "pending" }] } }],
      pageParams: [null],
    } satisfies InfiniteData<ActivityPage>);
    const secondAttempt = deferred<unknown>();
    let calls = 0;
    const view = render(<HookHarness owner={owner} fetchActivity={async (request) => {
      calls++;
      if (calls === 1) return partialPage(request, WALLET_A, [cardPurchase]);
      if (calls === 2) return secondAttempt.promise;
      throw new ResourceFailure("network");
    }} />);
    await flushMountedRecovery();
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    await act(async () => { await advanceFirstPageRetry(activityFirstPageRetryDelaysMs[0]); });
    expect(calls).toBe(2);
    const state = scope.queryClient.getQueryState(currentKey)!;
    const newerCard = { ...cardPurchase, id: "ipi_newer" };
    await act(async () => {
      scope.queryClient.setQueryData<InfiniteData<ActivityPage>>(currentKey, (old) => old && {
        ...old, pages: [{ ...old.pages[0]!, cards: { status: "ready", rows: [newerCard] } }, ...old.pages.slice(1)],
      }, { updatedAt: state.dataUpdatedAt });
    });
    const newer = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    const newerState = scope.queryClient.getQueryState(currentKey)!;
    expect(newerState.dataUpdatedAt).toBe(state.dataUpdatedAt);
    expect(newerState.dataUpdateCount).toBe(state.dataUpdateCount + 1);
    await act(async () => {
      secondAttempt.reject(new ResourceFailure("network"));
      await flushRecovery();
    });
    await act(async () => { await advanceFirstPageRetry(activityFirstPageRetryDelaysMs[1]); });
    await flushMountedRecovery();
    expect(calls).toBe(3);
    expect(view.getByTestId("card-ids").textContent).toBe(newerCard.id);
    expect(view.getByTestId("ids").textContent).toBe("kept");
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)).toBe(newer);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(newerState.dataUpdatedAt);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdateCount).toBe(newerState.dataUpdateCount);
  });

  test("a cold start partial before exhausted transient failures still fails", async () => {
    jest.useFakeTimers();
    getHomeQueryClient().clear();
    let calls = 0;
    const view = render(<HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={async (request) => {
      calls++;
      if (calls === 1) return partialPage(request, WALLET_A, [cardPurchase]);
      throw new ResourceFailure("network");
    }} />);
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    await flushMountedRecovery();
    expect(view.getByTestId("status").textContent).toBe("error");
    expect(calls).toBe(3);
  });

  test("canceling during a partial retry delay leaves same-window cards unchanged", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    scope.queryClient.setQueryData<InfiniteData<ActivityPage>>(currentKey, (old) => old && {
      ...old, pages: [{ ...old.pages[0]!, cards: { status: "ready", rows: [{ ...cardPurchase, id: "ipi_cached" }] } }],
    });
    const current = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    const updatedAt = scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt;
    let calls = 0;
    let signal: AbortSignal | undefined;
    const view = render(<HookHarness owner={owner} fetchActivity={async (request, currentSignal) => {
      calls++;
      signal = currentSignal;
      return partialPage(request, WALLET_A, [cardPurchase]);
    }} />);
    await flushMountedRecovery();
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    expect(calls).toBe(1);
    await act(async () => { await scope.queryClient.cancelQueries({ queryKey: currentKey, exact: true }); });
    await act(async () => { await advanceFirstPageRetry(2_000); });
    await flushMountedRecovery();
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
    expect(view.getByTestId("card-ids").textContent).toBe("ipi_cached");
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)).toEqual(current);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(updatedAt);
  });

  test("a card-only write during the final attempt is not overwritten even with the same updatedAt", async () => {
    jest.useFakeTimers();
    const owner = session("subject-a", WALLET_A);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    const finalPage = deferred<unknown>();
    const queries: string[] = [];
    const view = render(<HookHarness owner={owner} fetchActivity={async (request) => {
      queries.push(request);
      return queries.length === 3 ? finalPage.promise : partialPage(request, WALLET_A, [cardPurchase]);
    }} />);
    await flushMountedRecovery();
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    expect(queries).toHaveLength(3);
    const state = scope.queryClient.getQueryState(currentKey)!;
    const newerCard = { ...cardPurchase, id: "ipi_newer" };
    await act(async () => {
      scope.queryClient.setQueryData<InfiniteData<ActivityPage>>(currentKey, (old) => old && {
        ...old, pages: [{ ...old.pages[0]!, cards: { status: "ready", rows: [newerCard] } }, ...old.pages.slice(1)],
      }, { updatedAt: state.dataUpdatedAt });
    });
    const newer = scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)!;
    const newerState = scope.queryClient.getQueryState(currentKey)!;
    expect(newerState.dataUpdatedAt).toBe(state.dataUpdatedAt);
    expect(newerState.dataUpdateCount).toBe(state.dataUpdateCount + 1);
    await act(async () => {
      finalPage.resolve(partialPage(queries[2]!, WALLET_A, [cardPurchase]));
      await flushRecovery();
    });
    await flushMountedRecovery();
    expect(view.getByTestId("card-ids").textContent).toBe(newerCard.id);
    expect(view.getByTestId("onchain-status").textContent).toBe("healthy");
    expect(view.getByTestId("status").textContent).toBe("ready");
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)).toBe(newer);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdatedAt).toBe(newerState.dataUpdatedAt);
    expect(scope.queryClient.getQueryState(currentKey)!.dataUpdateCount).toBe(newerState.dataUpdateCount);
  });

  test("owner B's partial updates only owner B's same-window cache", async () => {
    jest.useFakeTimers();
    const otherScope = recoveryWindow(session("subject-a", WALLET_A));
    const otherKey = ownerQueryKey(otherScope.ownerKey, "activity", otherScope.windowEnd, "USD");
    otherScope.queryClient.setQueryData<InfiniteData<ActivityPage>>(otherKey, (old) => old && {
      ...old, pages: [{ ...old.pages[0]!, cards: { status: "ready", rows: [{ ...cardPurchase, id: "ipi_ownerA" }] } }],
    });
    const other = otherScope.queryClient.getQueryData<InfiniteData<ActivityPage>>(otherKey)!;
    const otherState = otherScope.queryClient.getQueryState(otherKey)!;
    const owner = session("subject-b", WALLET_B);
    const scope = recoveryWindow(owner);
    const currentKey = ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD");
    let calls = 0;
    const view = render(<HookHarness owner={owner} fetchActivity={async (request) => {
      calls++;
      return partialPage(request, WALLET_B, [cardPurchase]);
    }} />);
    await flushMountedRecovery();
    fireEvent.click(view.getByText("refetch"));
    await flushMountedRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) {
      await act(async () => { await advanceFirstPageRetry(delay); });
    }
    await flushMountedRecovery();
    expect(calls).toBe(3);
    expect(view.getByTestId("card-ids").textContent).toBe(cardPurchase.id);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(currentKey)?.pages[0]?.cards?.rows).toEqual([cardPurchase]);
    expect(otherScope.queryClient.getQueryData<InfiniteData<ActivityPage>>(otherKey)).toBe(other);
    expect(other.pages[0]?.cards?.rows.map((row) => row.id)).toEqual(["ipi_ownerA"]);
    expect(otherScope.queryClient.getQueryState(otherKey)!.dataUpdatedAt).toBe(otherState.dataUpdatedAt);
    expect(otherScope.queryClient.getQueryState(otherKey)!.dataUpdateCount).toBe(otherState.dataUpdateCount);
  });
});
