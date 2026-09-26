import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { TradeDirection } from "@/shared/trading/contract";
import type { UseActivityResult } from "./use-activity";
import { tradePrepareFixture } from "@/tests/browser/feature-map/fixtures";

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
    if (type !== title) expect(within(details).getByText("Operation").nextElementSibling?.textContent).toBe(type);
    else expect(within(details).queryByText("Operation")).toBeNull();
    expect(within(details).getByText("You receive").nextElementSibling?.textContent).toMatch(/^Estimated /);
  });

  test("missing trade metadata preserves the stored title", () => {
    const view = render(<ActivityPanelView activity={activity} operations={[operation("buy", "failed", false)]} />);
    expect(view.getByRole("button", { description: "View Stored title transaction details" }).textContent).toContain("Stored title");
  });
});
