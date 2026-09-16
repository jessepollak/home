import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import type { UseActivityResult } from "./use-activity";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ActivityPanelView } = await import("./activity-panel");

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const noop = () => undefined;

function transfer(id: string, minute: number): ActivityTransfer {
  return {
    id: `8453:${TOKEN}:${id}`,
    logId: id,
    chainId: 8453,
    assetId: "usdc",
    tokenAddress: TOKEN,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    walletAddress: WALLET,
    fromAddress: OTHER,
    toAddress: WALLET,
    direction: "incoming",
    amountBaseUnits: "1",
    blockNumber: String(minute),
    blockHash: `0x${"c".repeat(64)}`,
    transactionHash: `0x${minute.toString(16).padStart(64, "0")}`,
    logIndex: "1",
    blockTimestamp: `2026-09-15T12:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

function operation(id: string, minute: number, transactionHash?: `0x${string}`): RecentMoneyActionOperation {
  const updatedAt = `2026-09-15T12:${String(minute).padStart(2, "0")}:30.000Z`;
  return {
    action: { id, kind: "send", title: id, amounts: [], warnings: [], expiresAt: updatedAt, createdAt: updatedAt },
    status: "confirmed",
    createdAt: updatedAt,
    updatedAt,
    ...(transactionHash ? { transactionHash } : {}),
  };
}

function loading(): UseActivityResult {
  return {
    status: "loading",
    page: null,
    loadingMore: false,
    loadMoreError: false,
    autoLoadPaused: false,
    retry: noop,
    refresh: noop,
    loadMore: noop,
    retryLoadMore: noop,
  };
}

function ready(
  transfers: ActivityTransfer[],
  nextCursor: string | null = null,
  overrides: { loadingMore?: boolean } = {},
): UseActivityResult {
  const page: ActivityPage = {
    walletAddress: WALLET,
    chainId: 8453,
    window: { from: "2026-08-15T12:00:00.000Z", to: "2026-09-15T12:10:00.000Z" },
    transfers,
    nextCursor,
    source: {
      provider: "cdp-sql",
      cached: false,
      stale: false,
      executionTimestamp: "2026-09-15T12:10:00.000Z",
      executionTimeMs: 1,
      fetchedAt: "2026-09-15T12:10:00.000Z",
    },
  };
  return {
    status: "ready",
    page,
    loadingMore: overrides.loadingMore === true,
    loadMoreError: false,
    autoLoadPaused: false,
    retry: noop,
    refresh: noop,
    loadMore: noop,
    retryLoadMore: noop,
  };
}

function failed(retry: () => void = noop): UseActivityResult {
  return {
    status: "error",
    page: null,
    loadingMore: false,
    loadMoreError: false,
    autoLoadPaused: false,
    error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." },
    retry,
    refresh: noop,
    loadMore: noop,
    retryLoadMore: noop,
  };
}

afterEach(cleanup);

describe("combined Activity panel", () => {
  test("applies the teaser limit after interleaving into one semantic list", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([transfer("transfer-6", 6), transfer("transfer-4", 4), transfer("transfer-2", 2)])}
        operations={[operation("action-5", 5), operation("action-3", 3), operation("action-1", 1)]}
        density="teaser"
      />,
    );

    expect(view.getAllByRole("list")).toHaveLength(1);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(5);
    expect(view.queryByText("action-1")).toBeNull();
    expect(view.getByRole("list").textContent).toMatch(/Received.*action-5.*Received.*action-3.*Received/);
  });

  test("keeps recorded actions visible and retries when onchain activity fails", () => {
    const retry = mock(() => undefined);
    const view = render(
      <ActivityPanelView activity={failed(retry)} operations={[operation("recorded-action", 5)]} actionsStatus="ready" />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Onchain transfers are unavailable");
    expect(view.queryByRole("alert")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("keeps onchain rows visible and names an actions-source failure", () => {
    const view = render(
      <ActivityPanelView activity={ready([transfer("onchain", 5)])} actionsStatus="error" />,
    );

    expect(view.getByText("Received")).toBeTruthy();
    expect(view.getByText(/Recorded Home actions are unavailable/)).toBeTruthy();
    expect(within(view.getByRole("list")).getAllByRole("button")).toHaveLength(1);
  });

  test("waits for both sources to settle when transfers resolve before actions", () => {
    const view = render(
      <ActivityPanelView activity={ready([transfer("onchain", 5)], "cursor-1")} actionsStatus="loading" />,
    );

    expect(view.getByText("Loading recent activity…")).toBeTruthy();
    expect(view.queryByRole("list")).toBeNull();

    view.rerender(
      <ActivityPanelView
        activity={ready([transfer("onchain", 5)], "cursor-1")}
        operations={[operation("recorded-action", 6)]}
      />,
    );
    expect(view.queryByText("Loading recent activity…")).toBeNull();
    expect(view.getByText("Received")).toBeTruthy();
    expect(view.getByText("recorded-action")).toBeTruthy();

    view.rerender(
      <ActivityPanelView
        activity={ready([transfer("onchain", 5)], "cursor-1", { loadingMore: true })}
        operations={[operation("recorded-action", 6)]}
      />,
    );
    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.queryByText("Loading recent activity…")).toBeNull();
  });

  test("waits for both sources to settle when actions resolve before transfers", () => {
    const view = render(
      <ActivityPanelView activity={loading()} operations={[operation("recorded-action", 5)]} />,
    );

    expect(view.getByText("Loading recent activity…")).toBeTruthy();
    expect(view.queryByText("recorded-action")).toBeNull();

    view.rerender(
      <ActivityPanelView
        activity={ready([transfer("onchain", 6)])}
        operations={[operation("recorded-action", 5)]}
      />,
    );
    expect(view.queryByText("Loading recent activity…")).toBeNull();
    expect(view.getByText("Received")).toBeTruthy();
    expect(view.getByText("recorded-action")).toBeTruthy();
  });

  test("shows the same sparse fallbacks in page and teaser modes", () => {
    const operations = [
      operation("hashed-fallback", 6, `0x${"d".repeat(64)}` as const),
      operation("hashless-fallback", 4),
    ];
    const page = render(
      <ActivityPanelView activity={ready([], "cursor-1")} operations={operations} />,
    );
    const teaser = render(
      <ActivityPanelView activity={ready([], "cursor-1")} operations={operations} density="teaser" />,
    );

    for (const view of [page, teaser]) {
      expect(within(view.container).getByText("hashed-fallback")).toBeTruthy();
      expect(within(view.container).getByText("hashless-fallback")).toBeTruthy();
      expect(within(view.container).queryByText("No activity yet")).toBeNull();
    }
  });

  test("teaser still dedupes actions whose transfer is loaded", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([transfer("onchain", 5)], "cursor-1")}
        operations={[operation("twin", 6, `0x${(5).toString(16).padStart(64, "0")}` as const), operation("recorded-action", 4)]}
        density="teaser"
      />,
    );

    expect(view.getByText("Received")).toBeTruthy();
    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.queryByText("twin")).toBeNull();
  });

  test("keeps an unmatched hashed action while pages remain, then replaces it with a loaded match", () => {
    const matchingHash = `0x${"d".repeat(64)}` as const;
    const operations = [operation("hashed-fallback", 2, matchingHash), operation("hashless-fallback", 1)];
    const view = render(
      <ActivityPanelView activity={ready([transfer("onchain", 1)], "cursor-1")} operations={operations} />,
    );

    expect(view.getByText("hashed-fallback")).toBeTruthy();
    expect(view.getByText("hashless-fallback")).toBeTruthy();

    view.rerender(
      <ActivityPanelView
        activity={ready([
          transfer("onchain", 1),
          { ...transfer("loaded-match", 0), transactionHash: matchingHash },
        ], "cursor-2")}
        operations={operations}
      />,
    );

    expect(view.queryByText("hashed-fallback")).toBeNull();
    expect(view.getByText("hashless-fallback")).toBeTruthy();
    expect(within(view.getByRole("list")).getAllByText("Received")).toHaveLength(2);
  });
});
