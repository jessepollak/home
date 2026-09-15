import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import type { UseActivityResult } from "./use-activity";

const { cleanup, render, within } = await import("@testing-library/react");
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

function failed(): UseActivityResult {
  return {
    status: "error",
    page: null,
    loadingMore: false,
    loadMoreError: false,
    autoLoadPaused: false,
    error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." },
    retry: noop,
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

  test("keeps recorded actions visible when onchain activity fails", () => {
    const view = render(
      <ActivityPanelView activity={failed()} operations={[operation("recorded-action", 5)]} actionsStatus="ready" />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Onchain transfers are unavailable");
    expect(view.queryByRole("alert")).toBeNull();
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

  test("teaser shows sparse recorded actions while the transfer cursor is unresolved", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([], "cursor-1")}
        operations={[operation("twin-action", 6, `0x${"d".repeat(64)}` as const), operation("recorded-action", 4)]}
        density="teaser"
      />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.getByText("twin-action")).toBeTruthy();
    expect(view.queryByText("No activity yet")).toBeNull();
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

  test("withholds unloaded hashed actions in page mode until the cursor exhausts, but shows them in teaser", () => {
    // The action is confirmed 30s after the oldest loaded block timestamp, so
    // the old timestamp frontier would have exposed it; its transfer is on a
    // later page and must not be shadowed by a timestamp comparison.
    const operations = [
      operation("unloaded", 1, `0x${"d".repeat(64)}` as const),
      operation("hashless", 1),
    ];
    const page = render(
      <ActivityPanelView activity={ready([transfer("onchain", 1)], "cursor-1")} operations={operations} />,
    );
    expect(within(page.container).queryByText("unloaded")).toBeNull();
    expect(within(page.container).getByText("hashless")).toBeTruthy();

    const exhausted = render(
      <ActivityPanelView activity={ready([transfer("onchain", 1)])} operations={operations} />,
    );
    expect(within(exhausted.container).getByText("unloaded")).toBeTruthy();
    expect(within(exhausted.container).getByText("hashless")).toBeTruthy();

    const teaser = render(
      <ActivityPanelView
        activity={ready([transfer("onchain", 1)], "cursor-1")}
        operations={operations}
        density="teaser"
      />,
    );
    expect(within(teaser.container).getByText("unloaded")).toBeTruthy();
    expect(within(teaser.container).getByText("hashless")).toBeTruthy();
  });
});
