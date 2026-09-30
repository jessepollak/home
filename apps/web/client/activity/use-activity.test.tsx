import "../account/dom-test-harness";

import { getHomeQueryClient, ownerQueryKey } from "@/client/query/query-client";
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
import { activityWindowScope } from "@/client/query/after-action";
import { initialActivityWindowEnd } from "@/client/query/after-action";
import { defaultScheduler, notifyManager, type InfiniteData } from "@tanstack/react-query";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { useActivity, activityOwnerKey, activityFirstPageRetryDelaysMs, refreshLatestActivity } = await import("./use-activity");

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
          <output data-testid={`${testId}onchain-status`}>{activity.page.onchainStatus ?? "healthy"}</output>
          <output data-testid={`${testId}card-ids`}>{activity.page.cards?.rows.map((row) => row.id).join(",") ?? ""}</output>
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
  jest.useRealTimers();
  notifyManager.setScheduler(defaultScheduler);
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
    expect(view.getByTestId("card-ids").textContent).toBe("");
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
    let calls = 0;
    const pending = refreshLatestActivity({ ...scope, session: owner, regionId: "GLOBAL",
      fetchActivity: async (query) => { calls++; return partialPage(query, WALLET_A); },
      isCurrent: () => true, onPrefetchKey: () => {} }).catch((error: unknown) => error);
    await flushRecovery();
    for (const delay of activityFirstPageRetryDelaysMs) await advanceFirstPageRetry(delay);
    expect((await pending as Error).message).toBe("Activity onchain history is unavailable.");
    expect(calls).toBe(3);
    expect(scope.queryClient.getQueryData<string>(scope.windowKey)).toBe(scope.windowEnd);
    expect(scope.queryClient.getQueryData<InfiniteData<ActivityPage>>(ownerQueryKey(scope.ownerKey, "activity", scope.windowEnd, "USD"))?.pages[0]?.onchainStatus).toBeUndefined();
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
