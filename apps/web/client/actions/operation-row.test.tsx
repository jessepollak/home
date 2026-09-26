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
  test("renders the same quantity in the row and read-only detail across token classes", () => {
    for (const [symbol, decimals, amountBaseUnits] of [
      ["USDC", 6, "1234567"],
      ["ETH", 18, "1"],
      ["cbBTC", 8, "990000"],
      ["vault shares", 18, "999999"],
      ["ZORA", 18, "1234567890123456789012"],
    ] as const) {
      const original = operation("buy", "confirmed");
      const amount = { assetId: symbol, symbol, decimals, amountBaseUnits, direction: "spend" as const, estimated: true };
      const trade = { ...original, action: { ...original.action, amounts: [amount] } };
      const details = presentOperationDetails(trade, { regionId: "DE" });
      const display = details.rows.find((row) => row.label === "You pay")?.value;
      expect(display).toBeDefined();
      const view = render(<OperationActivityRow operation={trade} regionId="DE" onActivate={() => undefined} />);
      expect(view.getByRole("img", { name: `−~${display?.replace(/^Estimated /, "")}` })).toBeTruthy();
      expect(amount.amountBaseUnits).toBe(amountBaseUnits);
      cleanup();
    }
  });

  test("keeps a pending maximum debit exact in the row", () => {
    const original = operation("buy", "pending");
    const amount = { assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "100000362", direction: "spend" as const, maximum: true };
    const repay = { ...original, action: { ...original.action, amounts: [amount] } };
    const view = render(<OperationActivityRow operation={repay} regionId="US" onActivate={() => undefined} />);
    expect(view.getByRole("img", { name: "−100.000362 USDC" })).toBeTruthy();
  });

  test("missing trade metadata preserves the stored title", () => {
    const view = render(<OperationActivityRow operation={operation("buy", "failed", false)} regionId="US" onActivate={() => undefined} />);
    expect(view.getByText("Stored title")).toBeTruthy();
  });
});
