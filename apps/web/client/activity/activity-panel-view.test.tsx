import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import type { UseActivityResult } from "./use-activity";

const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
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
    tokenImageUrl: null,
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
    valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
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
    continuing: false,
    retry: noop,
    refresh: noop,
    setSentinelVisible: noop,
    retryLoadMore: noop,
  };
}

function ready(
  transfers: ActivityTransfer[],
  nextCursor: string | null = null,
  overrides: {
    loadingMore?: boolean;
    continuing?: boolean;
    loadMoreError?: boolean;
    retryLoadMore?: () => void;
  } = {},
): UseActivityResult {
  const page: ActivityPage = {
    walletAddress: WALLET,
    chainId: 8453,
    window: { from: "2026-08-15T12:00:00.000Z", to: "2026-09-15T12:10:00.000Z" },
    currency: "USD",
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
    loadMoreError: overrides.loadMoreError === true,
    continuing: overrides.continuing === true,
    retry: noop,
    refresh: noop,
    setSentinelVisible: noop,
    retryLoadMore: overrides.retryLoadMore ?? noop,
  };
}

function failed(retry: () => void = noop): UseActivityResult {
  return {
    status: "error",
    page: null,
    loadingMore: false,
    loadMoreError: false,
    continuing: false,
    error: { code: "ACTIVITY_UPSTREAM", message: "Recent Base activity could not be loaded." },
    retry,
    refresh: noop,
    setSentinelVisible: noop,
    retryLoadMore: noop,
  };
}

afterEach(cleanup);

describe("combined Activity panel", () => {
  test("interleaves every loaded row into one feed list with a spinner continuation", () => {
    const view = render(
      <ActivityPanelView
        activity={ready(
          [transfer("transfer-6", 6), transfer("transfer-4", 4), transfer("transfer-2", 2)],
          "cursor-1",
          { loadingMore: true },
        )}
        operations={[operation("action-5", 5), operation("action-3", 3), operation("action-1", 1)]}
        density="feed"
        header={<h2 id="activity-title">Activity</h2>}
      />,
    );

    expect(view.getAllByRole("list")).toHaveLength(1);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(5);
    expect(view.getByRole("list").textContent).toMatch(/Received.*action-5.*Received.*action-3.*Received/);
    expect(view.queryByText("action-1")).toBeNull();
    expect(view.getByRole("region", { name: "Activity" }).querySelectorAll("[data-slot='card']")).toHaveLength(1);
    expect(view.container.querySelector("[data-activity-loader]")).not.toBeNull();
    expect(view.container.querySelector("[data-shimmer='row']")).toBeNull();
  });

  test("keeps the feed heading, rows, and continuation sentinel inside a single Activity card", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([transfer("received", 5)], "cursor-1")}
        density="feed"
        header={<h2 id="activity-title">Activity</h2>}
      />,
    );

    const region = view.getByRole("region", { name: "Activity" });
    const cards = region.querySelectorAll<HTMLElement>("[data-slot='card']");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(within(card).getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(within(card).getByRole("list")).toBeTruthy();
    expect(card.querySelector("[data-activity-sentinel]")).not.toBeNull();
  });

  test("localizes transfer and recorded action dates and action amounts in the same feed", async () => {
    const sent = operation("Sent USDC", 6);
    sent.action.amounts = [{
      assetId: "usdc", symbol: "USDC", decimals: 6,
      amountBaseUnits: "1234567890", direction: "spend",
    }];
    const view = render(
      <ActivityPanelView activity={ready([transfer("received", 5)])} operations={[sent]} regionId="GB" />,
    );
    const actionRow = view.getByRole("button", { description: "View Sent USDC transaction details" });
    const transferRow = view.getByRole("button", { description: "View received USDC transaction details" });
    expect(actionRow.textContent).toMatch(/\d{1,2} Sept?\b/);
    expect(transferRow.textContent).toMatch(/\d{1,2} Sept?\b/);
    expect(actionRow.textContent).toContain("1,234.56 USDC");

    view.rerender(
      <ActivityPanelView activity={ready([transfer("received", 5)])} operations={[sent]} regionId="BR" />,
    );
    expect(actionRow.textContent).toMatch(/\d{1,2} de set\./);
    expect(transferRow.textContent).toMatch(/\d{1,2} de set\./);
    expect(actionRow.textContent).toContain("1.234,56 USDC");

    fireEvent.click(actionRow);
    const details = await view.findByRole("dialog", { name: "Sent USDC" });
    expect(within(details).getByText("Updated").nextElementSibling?.textContent).toMatch(/\d{1,2} de set\./);
    expect(within(details).getByText("You spend").nextElementSibling?.textContent).toBe("1.234,56789 USDC");
  });

  test("keeps transaction details during exit and restores focus after closing", async () => {
    const view = render(<ActivityPanelView activity={ready([transfer("received", 5)])} />);
    const opener = view.getByRole("button", { description: "View received USDC transaction details" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await view.findByRole("dialog", { name: "Received USDC" });

    const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
    animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close transaction details" }));
      expect(within(dialog).getByText("Received USDC")).toBeTruthy();
      expect(within(dialog).getByText("Amount")).toBeTruthy();
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      delete animationFlag.BASE_UI_ANIMATIONS_DISABLED;
    }
  });

  test("renders exact-contract logos and bounded fallback marks for long and missing symbols", () => {
    const zora = "0x1111111111166b7fe7bd91427724b487980afc69" as const;
    const credits = "0x4444444444444444444444444444444444444444" as const;
    const unknown = "0x5555555555555555555555555555555555555555" as const;
    const imageUrl = "https://token-media.defined.fi/zora.png";
    const rows = [
      { ...transfer("logo", 3), id: `8453:${zora}:logo`, tokenAddress: zora, assetId: null, tokenSymbol: "ZORA", tokenDecimals: 18, tokenImageUrl: imageUrl },
      { ...transfer("credits", 2), id: `8453:${credits}:credits`, tokenAddress: credits, assetId: null, tokenSymbol: "CREDITS", tokenDecimals: 18 },
      { ...transfer("unknown", 1), id: `8453:${unknown}:unknown`, tokenAddress: unknown, assetId: null, tokenSymbol: null, tokenDecimals: null },
    ];
    const view = render(<ActivityPanelView activity={ready(rows)} />);
    const logo = view.getByRole("button", { description: "View received ZORA transaction details" });
    expect(logo.querySelector("img")?.getAttribute("src")).toBe(imageUrl);
    const longSymbol = view.getByRole("button", { description: "View received CREDITS transaction details" });
    expect(longSymbol.querySelector("[data-mark-inner]")?.textContent).toBe("CR");
    const missingSymbol = view.getByRole("button", { description: "View received unknown token transaction details" });
    expect(missingSymbol.querySelector("[data-mark-inner]")?.textContent).toBe("?");
  });

  test("marks money in with the gain tone and leaves money out in the default tone", () => {
    const outgoing = { ...transfer("sent", 3), direction: "outgoing" as const, fromAddress: WALLET, toAddress: OTHER };
    const view = render(
      <ActivityPanelView activity={ready([transfer("received", 4), outgoing])} density="feed" />,
    );
    const tones = [...view.container.querySelectorAll("[data-value-tone]")]
      .map((value) => value.getAttribute("data-value-tone"));

    expect(tones).toEqual(["success", "default"]);
  });

  test("keeps recorded actions visible and retries when onchain activity fails", () => {
    const retry = mock(() => undefined);
    const view = render(
      <ActivityPanelView activity={failed(retry)} operations={[operation("recorded-action", 5)]} actionsStatus="ready" />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Onchain transfers are unavailable");
    expect(view.queryByRole("alert")).toBeNull();

    fireEvent.click(view.getByRole("button", { name: "Retry onchain transfers" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("names both page retry controls distinctly and retries only their failed source", () => {
    const retry = mock(() => undefined);
    const retryActions = mock(() => undefined);
    const view = render(
      <ActivityPanelView
        activity={failed(retry)}
        operations={[operation("recorded-action", 5)]}
        actionsStatus="error"
        retryActions={retryActions}
      />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry onchain transfers" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryActions).toHaveBeenCalledTimes(0);
    fireEvent.click(view.getByRole("button", { name: "Retry recorded actions" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryActions).toHaveBeenCalledTimes(1);
  });

  test("shows a centered muted Activity unavailable line with a reload icon instead of an alert", () => {
    const retry = mock(() => undefined);
    const retryActions = mock(() => undefined);
    const view = render(
      <ActivityPanelView
        activity={failed(retry)}
        actionsStatus="error"
        density="feed"
        retryActions={retryActions}
      />,
    );

    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    const unavailable = view.container.querySelector<HTMLElement>("[data-activity-unavailable]");
    expect(within(unavailable!).getByRole("status").textContent).toBe("Activity unavailable");

    fireEvent.click(within(unavailable!).getByRole("button", { name: "Reload activity" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryActions).toHaveBeenCalledTimes(1);
  });

  test("keeps loaded rows and names the missing source in the Home feed", () => {
    const view = render(
      <ActivityPanelView
        activity={failed()}
        operations={[operation("recorded-action", 5)]}
        density="feed"
      />,
    );

    expect(view.getByText("recorded-action")).toBeTruthy();
    expect(view.getByRole("status").textContent).toBe("Some activity is unavailable");
    expect(view.queryByRole("alert")).toBeNull();
  });

  test("keeps the continuation region mounted through idle, between-page loading, and failure", () => {
    const retryLoadMore = mock(() => undefined);
    const activity = (overrides: Parameters<typeof ready>[2] = {}) =>
      <ActivityPanelView activity={ready([transfer("transfer-2", 2)], "cursor-1", { ...overrides, retryLoadMore })} />;
    const view = render(activity());
    const region = view.container.querySelector("[data-activity-continuation]");
    const sentinel = view.container.querySelector("[data-activity-sentinel]");
    expect(region).not.toBeNull();
    expect(view.container.querySelector("[data-activity-loader]")).toBeNull();

    view.rerender(activity({ continuing: true }));
    expect(view.container.querySelector("[data-activity-continuation]")).toBe(region);
    expect(view.getByRole("status", { name: "" }).textContent).toBe("Loading older activity");
    expect(view.container.querySelector("[data-activity-loader]")).not.toBeNull();

    view.rerender(activity({ continuing: true, loadMoreError: true }));
    expect(view.container.querySelector("[data-activity-continuation]")).toBe(region);
    expect(view.container.querySelector("[data-activity-loader]")).toBeNull();
    expect(view.getByRole("alert").textContent).toContain("More activity could not be loaded");
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(retryLoadMore).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector("[data-activity-sentinel]")).toBe(sentinel);
  });

  test("retries an older page from the Home feed without a red alert", () => {
    const retryLoadMore = mock(() => undefined);
    const view = render(
      <ActivityPanelView
        activity={ready([transfer("transfer-2", 2)], "cursor-1", { loadMoreError: true, retryLoadMore })}
        density="feed"
      />,
    );

    expect(view.queryByRole("alert")).toBeNull();
    const unavailable = view.container.querySelector<HTMLElement>("[data-activity-unavailable]");
    expect(unavailable?.textContent).toContain("More activity unavailable");
    fireEvent.click(within(unavailable!).getByRole("button", { name: "Reload activity" }));
    expect(retryLoadMore).toHaveBeenCalledTimes(1);
  });

  test("shows one Home feed status line when recorded actions and an older page both fail", () => {
    const retryLoadMore = mock(() => undefined);
    const retryActions = mock(() => undefined);
    const view = render(
      <ActivityPanelView
        activity={ready([transfer("transfer-2", 2)], "cursor-1", { loadMoreError: true, retryLoadMore })}
        actionsStatus="error"
        density="feed"
        retryActions={retryActions}
      />,
    );

    const lines = view.container.querySelectorAll<HTMLElement>("[data-activity-unavailable]");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toContain("Some activity is unavailable");
    fireEvent.click(within(lines[0]!).getByRole("button", { name: "Reload activity" }));
    expect(retryActions).toHaveBeenCalledTimes(1);
    expect(retryLoadMore).toHaveBeenCalledTimes(1);
  });

  test("offers a centered Add money prompt when the Home feed is empty", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([])}
        density="feed"
        emptyAction={<button type="button">Add money</button>}
      />,
    );

    const prompt = view.container.querySelector<HTMLElement>("[data-activity-nux]");
    expect(prompt?.textContent).toContain("No activity yet");
    expect(within(prompt!).getByRole("button", { name: "Add money" })).toBeTruthy();
    expect(view.container.querySelector("[data-activity-unavailable]")).toBeNull();
    const region = view.getByRole("region", { name: "Activity" });
    const cards = region.querySelectorAll<HTMLElement>("[data-slot='card']");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.contains(prompt)).toBe(true);
  });

  test("does not claim an empty feed when recorded actions fail on the Home feed", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([])}
        actionsStatus="error"
        density="feed"
        emptyAction={<button type="button">Add money</button>}
      />,
    );

    expect(view.container.querySelector("[data-activity-nux]")).toBeNull();
    expect(view.queryByText("No activity yet")).toBeNull();
    expect(view.queryByRole("button", { name: "Add money" })).toBeNull();
    expect(view.container.querySelector("[data-activity-unavailable]")?.textContent)
      .toContain("Activity unavailable");
  });

  test("names an actions-source failure instead of an empty feed on the page", () => {
    const view = render(
      <ActivityPanelView
        activity={ready([])}
        actionsStatus="error"
        emptyAction={<button type="button">Add money</button>}
      />,
    );

    expect(view.getByText(/Recorded Home actions are unavailable/)).toBeTruthy();
    expect(view.queryByText("No activity yet")).toBeNull();
    expect(view.queryByRole("button", { name: "Add money" })).toBeNull();
  });

  test("shows the bundled mark for an action keyed by id or by asset key", () => {
    const amount = { direction: "spend" as const, symbol: "USDC", decimals: 6, amountBaseUnits: "1000000" };
    const byKey = operation("Saved", 5);
    byKey.action.amounts = [{ ...amount, assetId: `eip155:8453/erc20:${TOKEN}` }];
    const byId = operation("Sent", 6);
    byId.action.amounts = [{ ...amount, assetId: "usdc" }];
    const spoofed = operation("Other", 7);
    spoofed.action.amounts = [{ ...amount, assetId: "eip155:8453/erc20:0x0000000000000000000000000000000000000bad" }];
    const view = render(
      <ActivityPanelView activity={ready([])} operations={[byKey, byId, spoofed]} />,
    );
    const sources = [...view.container.querySelectorAll("img")].map((image) => image.getAttribute("src"));

    expect(sources).toEqual(["/asset-marks/usdc.svg", "/asset-marks/usdc.svg"]);
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

  test("shows the same sparse fallbacks in page and feed modes", () => {
    const operations = [
      operation("hashed-fallback", 6, `0x${"d".repeat(64)}` as const),
      operation("hashless-fallback", 4),
    ];
    for (const item of operations) item.status = "pending";
    const page = render(
      <ActivityPanelView activity={ready([], "cursor-1")} operations={operations} />,
    );
    const feed = render(
      <ActivityPanelView activity={ready([], "cursor-1")} operations={operations} density="feed" />,
    );

    for (const view of [page, feed]) {
      expect(within(view.container).getByText("hashed-fallback")).toBeTruthy();
      expect(within(view.container).getByText("hashless-fallback")).toBeTruthy();
      expect(within(view.container).queryByText("No activity yet")).toBeNull();
    }
  });

  test("holds an old confirmed action until transfer pages reach it and shows it at the authoritative end", () => {
    const newer = transfer("newer", 10);
    const old = operation("old-cash-out", 2);
    old.status = "confirmed";
    const paging = render(<ActivityPanelView activity={ready([newer], "cursor-1")} operations={[old]} />);
    expect(within(paging.container).queryByText("old-cash-out")).toBeNull();
    paging.unmount();
    const sparse = render(<ActivityPanelView activity={ready([], "cursor-1")} operations={[old]} />);
    expect(within(sparse.container).queryByText("old-cash-out")).toBeNull();
    sparse.unmount();
    const ended = render(<ActivityPanelView activity={ready([newer], null)} operations={[old]} />);
    expect(within(ended.container).getByText("old-cash-out")).toBeTruthy();
  });

  test("the feed keeps an indexed action's title and confirmed status instead of a generic transfer", async () => {
    const indexed = { ...transfer("onchain", 5), direction: "outgoing" as const, amountBaseUnits: "1250000" };
    const deposit = operation("Deposit USDC into Morpho", 6, indexed.transactionHash);
    deposit.status = "pending";
    deposit.action.kind = "savings-deposit";
    deposit.action.amounts = [{ assetId: "usdc", symbol: "USDC", decimals: 6,
      amountBaseUnits: "1000000", direction: "spend", estimated: true }];
    const view = render(
      <ActivityPanelView
        activity={ready([indexed], "cursor-1")}
        operations={[deposit, { ...operation("recorded-action", 4), status: "pending" }]}
        density="feed"
      />,
    );

    const row = view.getByRole("button", { description: "View Deposit USDC into Morpho transaction details" });
    expect(row.textContent).toContain("Deposit USDC into Morpho");
    expect(row.textContent).toContain("Confirmed");
    expect(row.textContent).toContain("1.25 USDC");
    expect(row.textContent).not.toContain("~");
    expect(view.queryByText("Received")).toBeNull();
    expect(view.getByText("recorded-action")).toBeTruthy();

    fireEvent.click(row);
    const details = await view.findByRole("dialog", { name: "Deposit USDC into Morpho" });
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    expect(within(details).getByText("You spend").nextElementSibling?.textContent).toContain("1.25 USDC");
    expect(details.textContent).not.toContain("Estimated");
    expect(within(details).getByRole("heading", { name: "Deposit USDC into Morpho" })).toBeTruthy();
  });

  test("shows the action provider in details when a matching cash-out transfer is indexed", async () => {
    const indexed = transfer("cash-out", 5);
    const cashout = operation("Cash out with Peer", 6, indexed.transactionHash);
    cashout.status = "pending";
    cashout.action.kind = "cash-out";
    cashout.action.metadata = {
      product: "cashout",
      operation: "withdraw",
      providerId: "peer",
      providerName: "Peer",
      environment: "production",
      platform: "cashapp",
      platformLabel: "Cash App",
      currency: "USD",
      depositId: "cashout-order",
      approximateFiatAmount: "1",
      minConversionRate: "1",
      intentAmountRange: { min: "1000000", max: "1000000" },
      estimateAsOf: cashout.updatedAt,
      escrow: "0x777777779d229cdF3110e9de47943791c26300Ef",
    };
    const view = render(<ActivityPanelView activity={ready([indexed])} operations={[cashout]} />);

    fireEvent.click(view.getByRole("button", { description: "View Cash out with Peer transaction details" }));
    const details = await view.findByRole("dialog", { name: "Cash out with Peer" });
    expect(within(details).getByText("Provider").nextElementSibling?.textContent).toBe("Peer");
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    expect(view.queryByText("Received")).toBeNull();
  });

  test("keeps an unmatched hashed action while pages remain, then hides its later loaded transfer", () => {
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

    expect(view.getByText("hashed-fallback")).toBeTruthy();
    expect(view.getByText("hashless-fallback")).toBeTruthy();
    expect(within(view.getByRole("list")).getAllByText("Received")).toHaveLength(1);
    expect(within(view.getByRole("list")).getAllByRole("button", { description: /transaction details/ })).toHaveLength(3);
  });
});
