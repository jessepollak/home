import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { presentOperationDetails, titleForOperation } from "@/client/actions/operation-details";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { TradeDirection } from "@/shared/trading/contract";
import type { UseActivityResult } from "./use-activity";
import { tradePrepareFixture } from "@/tests/browser/feature-map/fixtures";

const { cleanup, render } = await import("@testing-library/react");
const { ActivityPanelView } = await import("./activity-panel");
const noop = () => undefined;

function operation(direction: TradeDirection, status: RecentMoneyActionOperation["status"]): RecentMoneyActionOperation {
  const action = tradePrepareFixture(direction);
  const timestamp = "2026-09-15T12:09:00.000Z";
  return {
    action: {
      id: action.id, kind: "trade", title: action.title,
      amounts: action.amounts as RecentMoneyActionOperation["action"]["amounts"],
      metadata: action.metadata as RecentMoneyActionOperation["action"]["metadata"],
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
    ["buy", "confirmed", "Bought Bitcoin", "Buy Bitcoin", "Confirmed"],
    ["sell", "confirmed", "Sold Bitcoin", "Sell Bitcoin", "Confirmed"],
    ["buy", "pending", "Buying Bitcoin", "Buy Bitcoin", "Pending"],
    ["sell", "pending", "Selling Bitcoin", "Sell Bitcoin", "Pending"],
    ["buy", "failed", "Buy Bitcoin failed", "Buy Bitcoin", "Failed"],
    ["sell", "failed", "Sell Bitcoin failed", "Sell Bitcoin", "Failed"],
    ["buy", "unknown", "Buy Bitcoin", "Buy Bitcoin", "Outcome unknown"],
    ["sell", "unknown", "Sell Bitcoin", "Sell Bitcoin", "Outcome unknown"],
  ] as const)("%s %s shows its activity title and both movement amounts", (direction, status, label, type, statusLabel) => {
    const trade = operation(direction, status);
    const view = render(<ActivityPanelView activity={activity} operations={[trade]} />);
    expect(view.getByRole("button", { name: new RegExp(`^${label}.*${statusLabel}`) })).toBeTruthy();
    const details = presentOperationDetails(trade);
    expect(titleForOperation(trade)).toBe(label);
    expect(details.title).toBe(label);
    expect(details.rows).toContainEqual({ label: "Type", value: type });
    expect(details.rows.some((row) => row.label === "You pay")).toBe(true);
    expect(details.rows.some((row) => row.label === "You receive" && String(row.value).startsWith("Estimated "))).toBe(true);
  });
});
