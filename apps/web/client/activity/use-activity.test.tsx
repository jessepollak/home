import "../account/dom-test-harness";

import { getHomeQueryClient } from "@/client/query/query-client";
import { afterEach, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActivityPage, ActivityTransfer, FetchActivity } from "./types";

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { useActivity } = await import("./use-activity");

const WALLET_A = "0x1111111111111111111111111111111111111111" as const;
const WALLET_B = "0x2222222222222222222222222222222222222222" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;

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
  };
}

function page(
  query: string,
  walletAddress: typeof WALLET_A | typeof WALLET_B,
  transfers: ActivityTransfer[],
  nextCursor: string | null,
): ActivityPage {
  const to = new URLSearchParams(query).get("to")!;
  return {
    walletAddress,
    chainId: 8453,
    window: {
      from: new Date(new Date(to).getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      to,
    },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function HookHarness({
  owner,
  fetchActivity,
  testId = "",
}: {
  owner: VerifiedAccountSession | null;
  fetchActivity: FetchActivity;
  testId?: string;
}) {
  const activity = useActivity(owner, fetchActivity);
  return (
    <div>
      <output data-testid={`${testId}status`}>{activity.status}</output>
      {activity.status === "ready" ? (
        <>
          <output data-testid={`${testId}ids`}>
            {activity.page.transfers.map((item) => item.logId).join(",")}
          </output>
          <output data-testid="cursor">{activity.page.nextCursor ?? "end"}</output>
          <output data-testid="loading-more">
            {String(activity.loadingMore)}
          </output>
          <output data-testid="load-more-error">
            {String(activity.loadMoreError)}
          </output>
          <button type="button" onClick={activity.loadMore}>automatic attempt</button>
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
    const queries: string[] = [];
    let firstTransfer: ActivityTransfer | null = null;
    const fetchActivity: FetchActivity = async (query) => {
      queries.push(query);
      if (queries.length === 1) {
        firstTransfer = transfer(query, WALLET_A, "event-30", "30");
        return page(query, WALLET_A, [firstTransfer], "cursor-1");
      }
      if (queries.length === 2) return pendingSecond.promise;
      return page(
        query,
        WALLET_A,
        [transfer(query, WALLET_A, "event-10", "10")],
        null,
      );
    };
    const view = render(
      <HookHarness owner={session("subject-a", WALLET_A)} fetchActivity={fetchActivity} />,
    );

    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-1"));
    fireEvent.click(view.getByText("automatic attempt"));
    fireEvent.click(view.getByText("automatic attempt"));
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

    fireEvent.click(view.getByText("automatic attempt"));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("end"));
    expect(view.getByTestId("ids").textContent).toBe(
      "event-30,event-20,event-10",
    );
    expect(queries).toHaveLength(3);
    const windowEnds = queries.map((query) => new URLSearchParams(query).get("to"));
    expect(new Set(windowEnds).size).toBe(1);
    expect(new URLSearchParams(queries[1]).get("cursor")).toBe("cursor-1");
    expect(new URLSearchParams(queries[2]).get("cursor")).toBe("cursor-2");
  });

  test("stops automatic retries after failure, permits explicit retry, and rejects cursor cycles", async () => {
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
      if (queries.length === 2) throw new Error("later page unavailable");
      if (queries.length === 3) {
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
    fireEvent.click(view.getByText("automatic attempt"));
    await waitFor(() =>
      expect(view.getByTestId("load-more-error").textContent).toBe("true"),
    );
    fireEvent.click(view.getByText("automatic attempt"));
    await act(async () => Promise.resolve());
    expect(queries).toHaveLength(2);

    fireEvent.click(view.getByText("manual retry"));
    await waitFor(() => expect(view.getByTestId("cursor").textContent).toBe("cursor-2"));
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");

    fireEvent.click(view.getByText("automatic attempt"));
    await waitFor(() =>
      expect(view.getByTestId("load-more-error").textContent).toBe("true"),
    );
    expect(view.getByTestId("cursor").textContent).toBe("cursor-2");
    expect(view.getByTestId("ids").textContent).toBe("event-30,event-20");
    expect(queries).toHaveLength(4);
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
    fireEvent.click(view.getByText("automatic attempt"));
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
  });
});
