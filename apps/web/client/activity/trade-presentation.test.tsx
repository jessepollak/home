import "@/client/account/dom-test-harness";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { TradeDirection } from "@/shared/trading/contract";
import type { UseActivityResult } from "./use-activity";
import { tradePrepareFixture } from "@/tests/browser/feature-map/fixtures";
import { OPERATOR_FEE_TOKEN } from "@/shared/fees/contract";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ActivityPanelView } = await import("./activity-panel");
const noop = () => undefined;

function operation(direction: TradeDirection, status: RecentMoneyActionOperation["status"], metadata = true): RecentMoneyActionOperation {
  const action = tradePrepareFixture(direction);
  const timestamp = "2026-09-15T12:09:00.000Z";
  return {
    action: {
      id: action.id, kind: "trade", title: "Stored title",
      amounts: action.amounts as RecentMoneyActionOperation["action"]["amounts"],
      ...(metadata ? { metadata: action.metadata as RecentMoneyActionOperation["action"]["metadata"] } : {}),
      warnings: [], createdAt: timestamp, expiresAt: timestamp,
    },
    status, createdAt: timestamp, updatedAt: timestamp,
  };
}
const activity: UseActivityResult = {
  status: "ready",
  page: {
    walletAddress: "0x1111111111111111111111111111111111111111", chainId: 8453,
    window: { from: "2026-09-14T12:00:00.000Z", to: "2026-09-15T12:10:00.000Z" },
    currency: "USD", transfers: [], nextCursor: null,
    source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: "2026-09-15T12:10:00.000Z", executionTimeMs: 1, fetchedAt: "2026-09-15T12:10:00.000Z" },
  },
  loadingMore: false, loadMoreError: false, continuing: false,
  retry: noop, refresh: noop, setSentinelVisible: noop, retryLoadMore: noop,
};

afterEach(cleanup);

beforeAll(async () => { await import("./activity-ledger-sheet"); });

describe("trade activity presentation", () => {
  test.each([
    ["buy", "confirmed", "Bought Bitcoin", "Buy Bitcoin"],
    ["sell", "confirmed", "Sold Bitcoin", "Sell Bitcoin"],
    ["buy", "pending", "Buying Bitcoin", "Buy Bitcoin"],
    ["sell", "pending", "Selling Bitcoin", "Sell Bitcoin"],
    ["buy", "failed", "Buy Bitcoin failed", "Buy Bitcoin"],
    ["sell", "failed", "Sell Bitcoin failed", "Sell Bitcoin"],
    ["buy", "unknown", "Buy Bitcoin", "Buy Bitcoin"],
    ["sell", "unknown", "Sell Bitcoin", "Sell Bitcoin"],
  ] as const)("%s %s shows its activity title and both movement amounts", async (direction, status, title, type) => {
    const view = render(<ActivityPanelView activity={activity} operations={[operation(direction, status)]} />);
    const row = view.getByRole("button", { description: `View ${title} transaction details` });
    expect(row.textContent).toContain(title);
    fireEvent.click(row);
    const details = await view.findByRole("dialog", { name: title });
    await within(details).findByText("You receive");
    if (type !== title) expect(within(details).getByText("Operation").nextElementSibling?.textContent).toBe(type);
    else expect(within(details).queryByText("Operation")).toBeNull();
    expect(within(details).getByText("You receive").nextElementSibling?.textContent).toMatch(/^Estimated /);
  });

  test("the traded contract keeps its full copyable address", async () => {
    const buy = operation("buy", "confirmed");
    const metadata = buy.action.metadata;
    if (metadata?.product !== "trade") throw new Error("trade fixture metadata missing");
    const view = render(<ActivityPanelView activity={activity} operations={[buy]} />);
    fireEvent.click(view.getByRole("button", { description: "View Bought Bitcoin transaction details" }));
    const details = await view.findByRole("dialog", { name: "Bought Bitcoin" });
    const contract = (await within(details).findByText(`${metadata.toAsset.symbol} contract`)).nextElementSibling;
    expect(contract?.querySelector(`[title="${metadata.toAsset.address}"]`)).not.toBeNull();
  });

  test.each([
    ["buy", "Bought Bitcoin", "$0.005 (0.5%)", "Estimated 0.000014 cbBTC"],
    ["sell", "Sold Bitcoin", "$0.17 (0.5%)", "Estimated 34.83 USDC"],
  ] as const)("a %s with an operator fee shows the service fee beside the customer amounts", async (direction, title, fee, receive) => {
    const trade = operation(direction, "confirmed");
    const metadata = trade.action.metadata;
    if (metadata?.product !== "trade") throw new Error("trade fixture metadata missing");
    const feeBaseUnits = direction === "buy" ? "5000" : "170000";
    metadata.operatorFee = { amountBaseUnits: feeBaseUnits, token: OPERATOR_FEE_TOKEN, bps: 50,
      recipient: "0x3333333333333333333333333333333333333333", collectedBy: "in-batch-transfer" };
    trade.action.amounts = trade.action.amounts.map((amount) => direction === "sell" && amount.direction === "receive"
      ? { ...amount, amountBaseUnits: (BigInt(amount.amountBaseUnits) - BigInt(feeBaseUnits)).toString() } : amount);
    const view = render(<ActivityPanelView activity={activity} operations={[trade]} />);
    fireEvent.click(view.getByRole("button", { description: `View ${title} transaction details` }));
    const details = await view.findByRole("dialog", { name: title });
    expect((await within(details).findByText("Service fee", {}, { timeout: 5_000 })).nextElementSibling?.textContent).toBe(fee);
    expect((await within(details).findByText("You receive", {}, { timeout: 5_000 })).nextElementSibling?.textContent).toBe(receive);
  });

  test("a trade without an operator fee has no service fee fact", async () => {
    const view = render(<ActivityPanelView activity={activity} operations={[operation("sell", "confirmed")]} />);
    fireEvent.click(view.getByRole("button", { description: "View Sold Bitcoin transaction details" }));
    const details = await view.findByRole("dialog", { name: "Sold Bitcoin" });
    expect(within(details).queryByText("Service fee")).toBeNull();
  });

  test("missing trade metadata preserves the stored title", () => {
    const view = render(<ActivityPanelView activity={activity} operations={[operation("buy", "failed", false)]} />);
    expect(view.getByRole("button", { description: "View Stored title transaction details" }).textContent).toContain("Stored title");
  });
});
