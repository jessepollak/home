import "@/client/account/dom-test-harness";

import { afterAll, afterEach, beforeEach, describe, expect, jest, mock, setSystemTime, spyOn, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { ActivityPage, ActivityTransfer } from "@/shared/activity/types";
import type { UseActivityResult } from "./use-activity";
import { formatPresentationDate, formatPresentationDateRange } from "@/shared/formatting";
import { activityOrdersFixture } from "@/tests/browser/feature-map/fixtures";

const financeRows = await import("@/components/finance-rows");
const rowSpy = spyOn(financeRows, "ActivityRow");
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const { ActivityPanelView } = await import("./activity-panel");

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const noop = () => undefined;
const NOW = Date.parse("2026-09-15T13:00:00.000Z");
beforeEach(() => setSystemTime(new Date(NOW)));

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

function cashoutSnapshot(
  updatedAt: string,
  amountAtomic: string,
  state: "awaiting-buyer" | "delivered",
): RecentMoneyActionOperation {
  const snapshot = operation("cash-out-snapshots", 1);
  snapshot.action.kind = "cash-out";
  snapshot.action.title = "Cash out with Peer";
  snapshot.action.amounts = [{ assetId: "usdc", symbol: "USDC", decimals: 6,
    amountBaseUnits: amountAtomic, direction: "spend" }];
  snapshot.status = "confirmed";
  snapshot.updatedAt = updatedAt;
  snapshot.cashout = {
    version: 1, providerId: "peer", region: "US", depositId: "deposit-1", state,
    platform: "cashapp", platformLabel: "Cash App", amountAtomic,
    filledAtomic: state === "delivered" ? amountAtomic : "0", returnedAtomic: "0",
    remainingAtomic: state === "delivered" ? "0" : amountAtomic,
    withdrawable: state === "awaiting-buyer", withdrawing: false,
    etaSeconds: 3600, settledAt: state === "delivered" ? updatedAt : null, updatedAt,
  };
  return snapshot;
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

const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
function mockRowHeight() {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return this.tagName === "LI" ? 64 : this.tagName === "MAIN" ? 800 : 0; },
  });
}
afterEach(() => {
  setSystemTime();
  jest.useRealTimers();
  cleanup();
  delete (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  rowSpy.mockClear();
});
afterAll(() => rowSpy.mockRestore());

describe("combined Activity panel", () => {
  test("bounds recent rows and announces the loaded group size", () => {
    mockRowHeight();
    const rows = Array.from({ length: 300 }, (_, index) => ({
      ...transfer(`long-${index}`, index % 60),
      direction: index % 2 ? "outgoing" as const : "incoming" as const,
      blockTimestamp: new Date(Date.parse("2026-09-15T12:59:00Z") - index * 60_000).toISOString(),
    }));
    const view = render(<ActivityPanelView activity={ready(rows, "next-page")} />);
    const list = view.getByRole("list");
    expect(list.querySelectorAll(":scope > li").length).toBeLessThan(50);
    expect(list.querySelector('li[aria-posinset="1"]')?.getAttribute("aria-setsize")).toBe("-1");
    view.rerender(<ActivityPanelView activity={ready(rows)} />);
    expect(list.querySelector('li[aria-posinset="1"]')?.getAttribute("aria-setsize")).toBe("300");
  });

  test("keeps a long expanded run windowed and removes its children on collapse", () => {
    mockRowHeight();
    const rows = Array.from({ length: 200 }, (_, index) => ({
      ...transfer(`run-${index}`, index % 60),
      blockTimestamp: new Date(Date.parse("2026-09-15T12:59:00Z") - index * 60_000).toISOString(),
    }));
    const view = render(<ActivityPanelView activity={ready(rows)} />);
    const list = view.getByRole("list");
    const summary = view.getByRole("button", { description: "200 Received USDC transfers" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(1);
    expect(view.queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
    fireEvent.click(summary);
    const controlledId = summary.getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    expect(document.getElementById(controlledId!)).toBe(list);
    expect(list.querySelectorAll(":scope > li").length).toBeLessThan(50);
    expect(list.querySelector('li[aria-posinset="2"]')?.getAttribute("aria-setsize")).toBe("201");
    expect(within(list).getAllByRole("button", { description: "View received USDC transaction details" }).length).toBeGreaterThan(0);
    expect(document.activeElement === summary || document.activeElement === document.body).toBe(true);
    fireEvent.click(summary);
    expect(summary.hasAttribute("aria-controls")).toBe(false);
    expect(document.getElementById(controlledId!)).toBe(list);
    expect(list.querySelectorAll(":scope > li")).toHaveLength(1);
    expect(view.queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
  });

  test("keeps a focused row mounted offscreen, then focuses Activity when that row is removed", async () => {
    mockRowHeight();
    const rows = Array.from({ length: 160 }, (_, index) => ({
      ...transfer(`focus-${index}`, index % 60),
      direction: index % 2 ? "outgoing" as const : "incoming" as const,
      blockTimestamp: new Date(Date.parse("2026-09-15T12:59:00Z") - index * 60_000).toISOString(),
    }));
    const view = render(<main data-app-main-authenticated=""><ActivityPanelView activity={ready(rows)} /></main>);
    const button = view.getByRole("list").querySelector('li[aria-posinset="1"] button')!;
    (button as HTMLButtonElement).focus();
    const main = view.container.querySelector("main")!;
    main.scrollTop = 8000;
    fireEvent.scroll(main);
    await waitFor(() => expect(button.isConnected).toBe(true));
    expect(document.activeElement).toBe(button);
    view.rerender(<main data-app-main-authenticated=""><ActivityPanelView activity={ready(rows.slice(1))} /></main>);
    expect(document.activeElement).toBe(view.getByRole("region", { name: "Activity" }));
  });

  test("focuses Activity when the final focused row disappears", () => {
    const view = render(<ActivityPanelView activity={ready([transfer("final", 5)])} />);
    const button = view.getByRole("list").querySelector("button")!;
    (button as HTMLButtonElement).focus();
    view.rerender(<ActivityPanelView activity={ready([])} />);
    expect(document.activeElement).toBe(view.getByRole("region", { name: "Activity" }));
  });

  test("skips unchanged row renders and updates a changed action", () => {
    const activity = ready([]);
    const first = operation("Recorded send", 5);
    const operations = [first];
    const view = render(<ActivityPanelView activity={activity} operations={operations}
      header={<h2 id="activity-title">Activity</h2>} />);
    expect(view.getByRole("button", { description: "View Recorded send transaction details" })).toBeTruthy();
    const rendered = rowSpy.mock.calls.length;
    view.rerender(<ActivityPanelView activity={activity} operations={operations}
      header={<h2 id="activity-title">History</h2>} onDetailsChange={() => undefined} />);
    expect(view.getByRole("heading", { name: "History" })).toBeTruthy();
    expect(rowSpy.mock.calls.length).toBe(rendered);
    const updated = { ...first, action: { ...first.action, title: "Updated send" } };
    view.rerender(<ActivityPanelView activity={activity} operations={[updated]}
      header={<h2 id="activity-title">History</h2>} />);
    expect(view.getByRole("button", { description: "View Updated send transaction details" })).toBeTruthy();
    expect(rowSpy.mock.calls.length).toBe(rendered + 1);
  });

  test("references the mounted recent list when transfer ids contain spaces", () => {
    const spaced = (id: string, minute: number) => ({ ...transfer(id, minute), id: `8453:synthetic/log id'with+chars ${id}` });
    const view = render(<ActivityPanelView activity={ready([spaced("a", 5), spaced("b", 4)])} />);
    const summary = view.getByRole("button", { description: "2 Received USDC transfers" });
    fireEvent.click(summary);
    const controls = summary.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(controls).not.toMatch(/\s/);
    const list = document.getElementById(controls!);
    expect(list).toBe(summary.closest("ul"));
    expect(within(list!).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(2);
  });

  test("keeps controlled list ids unique between simultaneously mounted ledgers with the same run", () => {
    const activity = ready([transfer("a", 5), transfer("b", 4)]);
    const view = render(<>
      <ActivityPanelView activity={activity} density="feed" />
      <ActivityPanelView activity={activity} density="page" />
    </>);
    const summaries = view.getAllByRole("button", { description: "2 Received USDC transfers" });
    expect(summaries).toHaveLength(2);
    for (const summary of summaries) fireEvent.click(summary);
    const allIds = summaries.map((summary) => summary.getAttribute("aria-controls")!);
    expect(allIds).toHaveLength(2);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const [index, id] of allIds.entries()) {
      expect(id).not.toMatch(/\s/);
      expect(view.container.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      const list = document.getElementById(id)!;
      expect(list).toBe(summaries[index]!.closest("ul")!);
      expect(within(list).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(2);
    }
    fireEvent.click(summaries[0]!);
    expect(summaries[0]!.hasAttribute("aria-controls")).toBe(false);
    expect(summaries[1]!.getAttribute("aria-controls")).toBe(allIds[1]);
    expect(within(document.getElementById(allIds[1]!)!).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(2);
  });

  test("summarizes the covered date range compactly and the full range for assistive technology", () => {
    const newest = transfer("new", 5);
    const oldest = { ...transfer("old", 4), blockTimestamp: "2026-09-14T12:04:00.000Z" };
    const short = formatPresentationDateRange(oldest.blockTimestamp, newest.blockTimestamp, { style: "activity-date" });
    const full = formatPresentationDateRange(oldest.blockTimestamp, newest.blockTimestamp, { style: "activity-full" });
    const view = render(<ActivityPanelView activity={ready([newest, oldest])} />);
    const summary = view.getByRole("button", { description: "2 Received USDC transfers" });
    expect(summary.textContent).toContain(`Received ×2`);
    expect(summary.textContent).toContain(short);
    expect(summary.textContent).toContain(full);
    expect(summary.querySelector("[title]")?.getAttribute("title")).toBe(full);

    const sameDay = { ...oldest, blockTimestamp: "2026-09-15T12:05:01.000Z" };
    view.rerender(<ActivityPanelView activity={ready([sameDay, newest])} />);
    const sameDaySummary = view.getByRole("button", { description: "2 Received USDC transfers" });
    const day = formatPresentationDate(newest.blockTimestamp, { style: "activity-date" });
    expect(sameDaySummary.textContent).toContain(day);
    expect(sameDaySummary.textContent).not.toContain(`${day} –`);
  });

  test("groups priced incoming runs in Home and Activity, reveals original details, and retains the continuation sentinel", async () => {
    const priced = (id: string, minute: number) => ({ ...transfer(id, minute),
      amountBaseUnits: "1000000",
      valuation: { status: "priced" as const, currency: "USD" as const, amount: { atoms: "100", scale: 2 },
        method: "peg" as const, peg: "USD" as const, close: null, fx: null },
    });
    for (const density of ["feed", "page"] as const) {
      const view = render(<ActivityPanelView activity={ready([priced("new", 5), priced("old", 4)], "cursor-1")} density={density} />);
      const summary = view.getByRole("button", { description: "2 Received USDC transfers" });
      expect(summary.textContent).toContain("Received ×2");
      expect(within(summary).getByRole("img", { name: "+$2.00" })).toBeTruthy();
      expect(within(summary).getByText("+2.00 USDC")).toBeTruthy();
      expect(view.queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
      expect(view.container.querySelector("[data-activity-sentinel]")).not.toBeNull();
      fireEvent.click(summary);
      expect(summary.getAttribute("aria-expanded")).toBe("true");
      const children = view.getAllByRole("button", { description: "View received USDC transaction details" });
      expect(document.getElementById(summary.getAttribute("aria-controls")!)).toBe(summary.closest("ul"));
      expect(children).toHaveLength(2);
      for (const child of children) {
        fireEvent.click(child);
        const dialog = await view.findByRole("dialog", { name: "Received" });
        expect(within(dialog).getByText("From")).toBeTruthy();
        const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
        animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
        try {
          fireEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
          await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
          await waitFor(() => expect(document.activeElement).toBe(child));
        } finally {
          delete animationFlag.BASE_UI_ANIMATIONS_DISABLED;
        }
      }
      fireEvent.click(summary);
      expect(view.queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
      view.unmount();
    }
  });

  test("keeps expanded summary identity across newer arrivals and page extension, and splits without hiding rows", () => {
    const current = [transfer("middle", 5), transfer("old", 4)];
    const view = render(<ActivityPanelView activity={ready(current, "cursor-1")} />);
    const summary = view.getByRole("button", { description: "2 Received USDC transfers" });
    summary.focus();
    fireEvent.click(summary);
    view.rerender(<ActivityPanelView activity={ready([transfer("head", 6), ...current], "cursor-1")} />);
    const newerSummary = view.getByRole("button", { description: "3 Received USDC transfers" });
    expect(newerSummary).toBe(summary);
    expect(document.activeElement).toBe(summary);
    expect(newerSummary.getAttribute("aria-expanded")).toBe("true");
    const controlledId = newerSummary.getAttribute("aria-controls");
    expect(controlledId).toBeTruthy();
    const list = document.getElementById(controlledId!);
    expect(list).toBe(summary.closest("ul"));
    expect(within(list!).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(3);
    view.rerender(<ActivityPanelView activity={ready([transfer("head", 6), ...current, transfer("tail", 3)], "cursor-2")} />);
    expect(view.getByRole("button", { description: "4 Received USDC transfers" })).toBe(summary);
    expect(summary.getAttribute("aria-controls")).toBe(controlledId);
    expect(document.getElementById(controlledId!)).toBe(list);
    expect(within(list!).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(4);
    const outgoing = { ...transfer("sent", 5), blockTimestamp: "2026-09-15T12:04:30.000Z" as const,
      direction: "outgoing" as const, fromAddress: WALLET, toAddress: OTHER };
    view.rerender(<ActivityPanelView activity={ready([transfer("head", 6), current[0]!, outgoing, current[1]!, transfer("tail", 3)], "cursor-2")} />);
    const summaries = view.getAllByRole("button", { description: /2 Received USDC transfers/ });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toBe(summary);
    expect(summaries.every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(summaries.every((button) => button.getAttribute("aria-controls") === controlledId)).toBe(true);
    expect(within(list!).getAllByRole("button", { description: "View received USDC transaction details" })).toHaveLength(4);
    expect(view.getByRole("button", { description: "View sent USDC transaction details" })).toBeTruthy();
    expect(view.container.querySelector("[data-activity-sentinel]")).not.toBeNull();
  });

  test("resets expanded runs when the account changes and keeps pending actions ungrouped", () => {
    const pending = { ...operation("Pending send", 7), status: "pending" as const };
    const view = render(<ActivityPanelView key={WALLET} activity={ready([transfer("a", 5), transfer("b", 4)])} operations={[pending]} />);
    const summary = view.getByRole("button", { description: "2 Received USDC transfers" });
    fireEvent.click(summary);
    expect(view.getByRole("button", { description: "View Pending send transaction details" }).closest("ul")?.getAttribute("aria-labelledby")).toBeTruthy();
    const changed = ready([transfer("a", 5), transfer("b", 4)]);
    if (changed.status !== "ready") throw new Error("Expected a ready page");
    changed.page.walletAddress = OTHER;
    view.rerender(<ActivityPanelView key={changed.page.walletAddress} activity={changed} operations={[pending]} />);
    const next = view.getByRole("button", { description: "2 Received USDC transfers" });
    expect(next).not.toBe(summary);
    expect(next.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("button", { description: "View received USDC transaction details" })).toBeNull();
    expect(view.getByRole("button", { description: "View Pending send transaction details" })).toBeTruthy();
  });
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
    expect(actionRow.textContent).toContain("−$1,234.56");

    view.rerender(
      <ActivityPanelView activity={ready([transfer("received", 5)])} operations={[sent]} regionId="BR" />,
    );
    expect(actionRow.textContent).toMatch(/\d{1,2} de set\./);
    expect(transferRow.textContent).toMatch(/\d{1,2} de set\./);
    expect(actionRow.textContent).toContain("$1.234,56");

    fireEvent.click(actionRow);
    const details = await view.findByRole("dialog", { name: "Sent USDC" });
    expect(within(details).getByText("Date").nextElementSibling?.textContent).toMatch(/\d{1,2} de set\./);
    expect(details.textContent).toContain("1.234,56 USDC");
  });

  test("only offers covered asset details and retains the selection across a return", async () => {
    (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
    const btc = { ...transfer("btc", 5), id: `8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf:btc`,
      tokenAddress: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as const,
      assetId: "cbbtc", tokenSymbol: "cbBTC", tokenDecimals: 8, amountBaseUnits: "10000000" };
    const activity = ready([btc, transfer("cash", 4)]);
    const key = `eip155:8453/erc20:${btc.tokenAddress}`;
    const openAsset = mock((_assetKey: string) => true);
    const props = { activity, canOpenAsset: (assetKey: string) => assetKey === key, onOpenAsset: openAsset };
    const view = render(<ActivityPanelView {...props} restoreDetailsRequest={0} />);
    const opener = view.getByRole("button", { description: "View received cbBTC transaction details" });
    opener.focus();
    fireEvent.click(opener);
    const details = await view.findByRole("dialog", { name: "Received" });
    expect(within(details).getByRole("button", { name: "Bitcoin Asset" })).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "Bitcoin Asset" }));
    expect(openAsset).toHaveBeenCalledWith(key);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    view.rerender(<ActivityPanelView {...props} restoreDetailsRequest={1} />);
    const restored = await view.findByRole("dialog", { name: "Received" });
    expect(restored.textContent).toContain("+0.1000 cbBTC");
    fireEvent.click(within(restored).getByRole("button", { name: "Close Received details" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(document.activeElement === view.getByRole("button", { description: "View received cbBTC transaction details" })).toBe(true);
    fireEvent.click(view.getByRole("button", { description: "View received USDC transaction details" }));
    expect(within(await view.findByRole("dialog", { name: "Received" })).queryByRole("button", { name: "US dollar Asset" })).toBeNull();
  });

  test("suspends an open selection immediately and restores it only while pending", async () => {
    (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
    const activity = ready([transfer("cash", 5)]);
    const view = render(<ActivityPanelView activity={activity} suspendDetailsRequest={0} restoreDetailsRequest={0} />);
    fireEvent.click(view.getByRole("button", { description: "View received USDC transaction details" }));
    expect(await view.findByRole("dialog", { name: "Received" })).toBeTruthy();

    view.rerender(<ActivityPanelView activity={activity} suspendDetailsRequest={1} restoreDetailsRequest={0} />);
    expect(view.queryByRole("dialog")).toBeNull();
    view.rerender(<ActivityPanelView activity={activity} suspendDetailsRequest={1} restoreDetailsRequest={1} />);
    expect(await view.findByRole("dialog", { name: "Received" })).toBeTruthy();
    view.rerender(<ActivityPanelView activity={activity} suspendDetailsRequest={2} restoreDetailsRequest={1} />);
    expect(view.queryByRole("dialog")).toBeNull();
    view.rerender(<ActivityPanelView activity={activity} suspendDetailsRequest={2} restoreDetailsRequest={2} />);
    const restored = await view.findByRole("dialog", { name: "Received" });
    fireEvent.click(within(restored).getByRole("button", { name: "Close Received details" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    view.rerender(<ActivityPanelView activity={activity} suspendDetailsRequest={2} restoreDetailsRequest={3} />);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  test("keeps the sheet open when asset navigation declines", async () => {
    (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
    const view = render(<ActivityPanelView activity={ready([transfer("cash", 5)])}
      canOpenAsset={() => true} onOpenAsset={() => false} />);
    fireEvent.click(view.getByRole("button", { description: "View received USDC transaction details" }));
    const details = await view.findByRole("dialog", { name: "Received" });
    fireEvent.click(within(details).getByRole("button", { name: "US dollar Asset" }));
    expect(view.getAllByRole("dialog")).toHaveLength(1);
  });

  test("keeps transaction details during exit and restores focus after closing", async () => {
    const view = render(<ActivityPanelView activity={ready([transfer("received", 5)])} />);
    const opener = view.getByRole("button", { description: "View received USDC transaction details" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await view.findByRole("dialog", { name: "Received" });

    const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
    animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
      expect(dialog.querySelector('[data-slot="activity-amount-number"]')?.textContent).toBe("+<0.01");
      expect(dialog.querySelector('[data-slot="activity-amount-unit"]')?.textContent).toBe("USDC");
      await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      delete animationFlag.BASE_UI_ANIMATIONS_DISABLED;
    }
  });

  test("focuses Activity after detail close when the selected row was removed", async () => {
    const changes = mock(() => {});
    const view = render(<ActivityPanelView activity={ready([transfer("removed", 5)])} header={null} onDetailsChange={changes} />);
    fireEvent.click(view.getByRole("button", { description: "View received USDC transaction details" }));
    const dialog = await view.findByRole("dialog", { name: "Received" });
    view.rerender(<ActivityPanelView activity={ready([])} header={null} onDetailsChange={changes} />);
    const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
    animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
    try {
      const close = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Close Received details" });
      expect(close.isConnected).toBe(true);
      expect(close.disabled).toBe(false);
      fireEvent.click(close);
      expect(changes).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(Boolean(view.queryByRole("dialog"))).toBe(false));
      await waitFor(() => expect(document.activeElement === view.getByRole("region", { name: "Activity" })).toBe(true));
    } finally {
      delete animationFlag.BASE_UI_ANIMATIONS_DISABLED;
    }
  });

  test("restores an unmounted detail opener from its ledger key", async () => {
    mockRowHeight();
    const rows = Array.from({ length: 160 }, (_, index) => ({
      ...transfer(`detail-${index}`, index % 60),
      direction: index % 2 ? "outgoing" as const : "incoming" as const,
      blockTimestamp: new Date(Date.parse("2026-09-15T12:59:00Z") - index * 60_000).toISOString(),
    }));
    const view = render(<main data-app-main-authenticated=""><ActivityPanelView activity={ready(rows)} /></main>);
    const main = view.container.querySelector("main")!;
    main.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      main.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
    };
    const opener = view.getByRole("list").querySelector('li[aria-posinset="1"] button') as HTMLButtonElement;
    opener.focus();
    fireEvent.click(opener);
    const dialog = await view.findByRole("dialog", { name: "Received" });
    main.scrollTop = 8000;
    fireEvent.scroll(main);
    await waitFor(() => expect(opener.isConnected).toBe(false));
    const animationFlag = globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean };
    animationFlag.BASE_UI_ANIMATIONS_DISABLED = true;
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close Received details" }));
      await waitFor(() => expect(Boolean(view.queryByRole("dialog"))).toBe(false));
      fireEvent.scroll(main);
      await waitFor(() => expect(document.activeElement === view.getByRole("list").querySelector('li[aria-posinset="1"] button')).toBe(true));
      expect(document.activeElement).not.toBe(opener);
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
  test("shows card purchases and onchain retry without an authoritative end marker when onchain is unavailable", () => {
    const retry = mock(() => undefined);
    const activity = ready([]);
    if (activity.status !== "ready") throw new Error("Expected ready activity");
    activity.page.cards = { status: "ready", rows: [{ id: "ipi_synthetic", kind: "transaction", amountMinor: "1234", currency: "USD",
      merchantName: "Synthetic Cafe", merchantCategory: null, status: "completed", declineReasonCode: null,
      createdAt: "2026-09-15T12:01:00.000Z", updatedAt: "2026-09-15T12:01:00.000Z" }] };
    activity.page.source = null;
    activity.page.onchainStatus = "unavailable";
    activity.retry = retry;
    const view = render(<ActivityPanelView activity={activity} />);
    expect(view.getByText("Synthetic Cafe")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("Onchain transfers are unavailable");
    expect(view.queryByText("End of activity")).toBeNull();
    expect(view.getByRole("list").querySelector('li[aria-posinset="1"]')?.getAttribute("aria-setsize")).toBe("-1");
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
    expect(view.getByRole("heading", { name: "Pending" })).toBeTruthy();
    expect(row.textContent).toContain("−$1.25");
    expect(row.textContent).not.toContain("~");
    expect(view.queryByText("Received")).toBeNull();
    expect(view.getByText("recorded-action")).toBeTruthy();

    fireEvent.click(row);
    const details = await view.findByRole("dialog", { name: "Deposit USDC into Morpho" });
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    expect(details.textContent).toContain("1.25 USDC");
    expect(details.textContent).not.toContain("Estimated");
    expect(within(details).getByRole("heading", { name: "Deposit USDC into Morpho" })).toBeTruthy();
  });

  test("opens the winning cash-out snapshot instead of an older pinned row", async () => {
    const older = cashoutSnapshot("2026-09-15T12:04:00.000Z", "50000000", "awaiting-buyer");
    const newer = cashoutSnapshot("2026-09-15T12:08:00.000Z", "75000000", "delivered");
    const view = render(<ActivityPanelView activity={ready([])} operations={[older, newer]} />);

    expect(view.getAllByRole("button", { description: "View Cash out to Cash App details" })).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { description: "View Cash out to Cash App details" }));
    const details = await view.findByRole("dialog", { name: "Cash out to Cash App" });
    expect(details.textContent).toContain("−75.00 USDC");
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    expect(within(details).queryByRole("button", { name: /Cancel cash-out/ })).toBeNull();
  });

  test("cancels using the same cash-out snapshot as the rendered row", async () => {
    const older = cashoutSnapshot("2026-09-15T12:04:00.000Z", "50000000", "awaiting-buyer");
    const newer = cashoutSnapshot("2026-09-15T12:08:00.000Z", "75000000", "awaiting-buyer");
    const onCancelCashout = mock((_operation: RecentMoneyActionOperation) => undefined);
    const view = render(<ActivityPanelView activity={ready([])} operations={[older, newer]} onCancelCashout={onCancelCashout} />);

    expect(view.getAllByRole("button", { description: "View Cash out to Cash App details" })).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { description: "View Cash out to Cash App details" }));
    const details = await view.findByRole("dialog", { name: "Cash out to Cash App" });
    expect(details.textContent).toContain("−75.00 USDC");
    fireEvent.click(within(details).getByRole("button", { name: "Cancel cash-out $75" }));
    expect(onCancelCashout).toHaveBeenCalledTimes(1);
    expect(onCancelCashout).toHaveBeenCalledWith(newer);
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

  test("keeps Pending above Recent in separate page cards and in Home's single Activity card", () => {
    const pending = { ...operation("Pending send", 7), status: "pending" as const };
    for (const density of ["page", "feed"] as const) {
      const view = render(<ActivityPanelView activity={ready([transfer("recent", 5)])} operations={[pending]} density={density} />);
      const section = view.getByRole("region", { name: "Activity" });
      const pendingHeading = within(section).getByRole("heading", { name: "Pending" });
      const recentHeading = within(section).getByRole("heading", { name: "Recent" });
      expect(pendingHeading.compareDocumentPosition(recentHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const pendingCard = pendingHeading.closest("[data-slot='card']");
      const recentCard = recentHeading.closest("[data-slot='card']");
      expect(pendingCard === recentCard).toBe(density === "feed");
      expect(pendingHeading.closest("[data-slot='card']")?.contains(within(section).getByText("Pending send"))).toBe(true);
      expect(within(section).getAllByRole("list")).toHaveLength(2);
      expect(section.querySelectorAll("[data-slot='card']").length).toBe(density === "feed" ? 1 : 2);
      view.unmount();
    }
  });

  test("omits group headers when nothing is pending", () => {
    const view = render(<ActivityPanelView activity={ready([transfer("recent", 5)])} />);
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    expect(view.queryByRole("heading", { name: "Recent" })).toBeNull();
    expect(view.getByRole("region", { name: "Activity" }).querySelectorAll("[data-slot='card']")).toHaveLength(1);
  });

  test("a matched transfer appears once and the next snapshot moves its action from Pending to Recent", () => {
    const indexed = transfer("indexed", 5);
    const pending = { ...operation("Send USDC", 7), status: "pending" as const };
    const view = render(<ActivityPanelView activity={ready([indexed])} operations={[pending]} />);
    expect(view.getByRole("heading", { name: "Pending" })).toBeTruthy();
    expect(view.getByRole("heading", { name: "Recent" })).toBeTruthy();
    const confirmed = { ...pending, status: "confirmed" as const, updatedAt: "2026-09-15T12:08:30.000Z" };
    view.rerender(<ActivityPanelView activity={ready([indexed])} operations={[confirmed]} />);
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(2);
    const matched = { ...confirmed, transactionHash: indexed.transactionHash };
    view.rerender(<ActivityPanelView activity={ready([indexed])} operations={[matched]} />);
    expect(view.getAllByRole("button", { description: /transaction details/ })).toHaveLength(1);
    expect(view.queryByText("Received")).toBeNull();
  });

  test("reveals Clear order at the deadline without a new orders response", async () => {
    const ambiguous = activityOrdersFixture().orders.find((order) => order.id === "fixture-funding-ambiguous");
    if (ambiguous?.kind !== "funding") throw new Error("Missing ambiguous funding order fixture");
    const activity = ready([]);
    const view = render(<ActivityPanelView activity={activity} orders={[{ ...ambiguous, clearableAt: null }]} regionId="US" />);
    fireEvent.click(view.getByRole("button", { description: "View Add money details" }));
    const dialog = await view.findByRole("dialog", { name: "Add money" });
    jest.useFakeTimers({ now: NOW });
    const orders = [{ ...ambiguous, clearableAt: new Date(NOW + 3_000).toISOString() }];
    view.rerender(<ActivityPanelView activity={activity} orders={orders} regionId="US" />);
    expect(within(dialog).getByText(/You can clear it after/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Clear order" })).toBeNull();
    await act(async () => { jest.advanceTimersByTime(3_001); });
    expect(within(dialog).getByRole("button", { name: "Clear order" })).toBeTruthy();
    expect(within(dialog).queryByText(/You can clear it after/)).toBeNull();
    jest.useRealTimers();
    await act(async () => { await Promise.resolve(); });
  });

  test("an ambiguous send shows Unconfirmed guidance with no recovery action", async () => {
    const ambiguous = { ...operation("Send USDC", 5), status: "unknown" as const };
    const view = render(<ActivityPanelView activity={ready([])} operations={[ambiguous]} />);
    fireEvent.click(view.getByRole("button", { description: "View Send USDC transaction details" }));
    const dialog = await view.findByRole("dialog", { name: "Send USDC" });
    expect(within(dialog).getByText("Unconfirmed")).toBeTruthy();
    expect(within(dialog).getByText("We can't confirm this yet")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /retry|try again|clear/i })).toBeNull();
    expect(dialog.querySelector("[data-slot='drawer-footer']")).toBeNull();
  });

  test("keeps the selected sheet current when its operation snapshot changes", async () => {
    const pending = { ...operation("Send USDC", 5), status: "pending" as const };
    const view = render(<ActivityPanelView activity={ready([])} operations={[pending]} />);
    fireEvent.click(view.getByRole("button", { description: "View Send USDC transaction details" }));
    const dialog = await view.findByRole("dialog", { name: "Send USDC" });
    expect(within(dialog).getByText("Pending")).toBeTruthy();
    view.rerender(<ActivityPanelView activity={ready([])} operations={[{ ...pending, status: "confirmed" }]} />);
    expect(within(dialog).getByText("Confirmed")).toBeTruthy();
    expect(view.queryByRole("heading", { name: "Pending" })).toBeNull();
    view.rerender(<ActivityPanelView activity={ready([])} operations={[]} />);
    expect(within(dialog).getByText("Confirmed")).toBeTruthy();
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
