import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { presentOperationDetails } from "./operation-details";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { TradeDirection } from "@/shared/trading/contract";
import { tradePrepareFixture } from "@/tests/browser/feature-map/fixtures";

const { cleanup, render } = await import("@testing-library/react");
const { OperationActivityRow } = await import("./operation-row");

afterEach(cleanup);

describe("trade activity rows", () => {
  const timestamp = "2026-09-15T12:09:00.000Z";
  function operation(direction: TradeDirection, status: RecentMoneyActionOperation["status"], metadata = true): RecentMoneyActionOperation {
    const action = tradePrepareFixture(direction);
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
  test.each([
    ["buy", "confirmed", "Bought Bitcoin"], ["sell", "confirmed", "Sold Bitcoin"],
    ["buy", "pending", "Buying Bitcoin"], ["sell", "pending", "Selling Bitcoin"],
    ["buy", "failed", "Buy Bitcoin failed"], ["sell", "failed", "Sell Bitcoin failed"],
    ["buy", "unknown", "Buy Bitcoin"], ["sell", "unknown", "Sell Bitcoin"],
  ] as const)("%s %s uses the trade presentation label", (direction, status, title) => {
    const trade = operation(direction, status);
    const view = render(<OperationActivityRow operation={trade} regionId="US" onActivate={() => undefined} />);
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByRole("button", { name: new RegExp(`^${title}`) })).toBeTruthy();
    expect(presentOperationDetails(trade).title).toBe(title);
  });
  test("USDC recent values are denominated dollars with direction and estimate prefixes, while other tokens keep units", () => {
    const trade = operation("buy", "confirmed");
    const usd = { ...trade, action: { ...trade.action, amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "123456789012", direction: "spend" as const, estimated: true }] } };
    const view = render(<OperationActivityRow operation={usd} regionId="US" onActivate={() => undefined} />);
    expect(view.getByRole("img", { name: "−~$123,456.78" })).toBeTruthy();
    view.rerender(<OperationActivityRow operation={{ ...usd, action: { ...usd.action, amounts: [{ ...usd.action.amounts[0]!, direction: "receive" }] } }} regionId="US" onActivate={() => undefined} />);
    expect(view.getByRole("img", { name: "+~$123,456.78" })).toBeTruthy();
    view.rerender(<OperationActivityRow operation={{ ...usd, action: { ...usd.action, amounts: [{ ...usd.action.amounts[0]!, symbol: "BTC", estimated: false }] } }} regionId="US" onActivate={() => undefined} />);
    expect(view.getByRole("img", { name: /BTC/ })).toBeTruthy();
  });
  test("missing trade metadata preserves the stored title", () => {
    const view = render(<OperationActivityRow operation={operation("buy", "failed", false)} regionId="US" onActivate={() => undefined} />);
    expect(view.getByText("Stored title")).toBeTruthy();
  });
});
