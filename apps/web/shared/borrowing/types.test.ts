import { describe, expect, test } from "bun:test";
import { DEFAULT_BORROW_MARKET } from "./config";
import {
  actionKindForBorrowOperation,
  parseBorrowActionIntent,
  type BorrowOperation,
} from "./types";

const marketId = DEFAULT_BORROW_MARKET.marketId;

describe("borrow operation contract", () => {
  test.each([
    ["supply-collateral", "supply-collateral"],
    ["borrow", "borrow"],
    ["supply-and-borrow", "borrow"],
    ["repay", "repay"],
    ["repay-all", "repay"],
    ["withdraw-collateral", "withdraw-collateral"],
    ["close-position", "repay"],
  ] as const)("maps %s to durable %s actions", (operation, kind) => {
    expect(actionKindForBorrowOperation(operation)).toBe(kind);
  });

  test.each([
    ["supply-collateral", { amountBaseUnits: "1" }],
    ["borrow", { amountBaseUnits: "1" }],
    ["supply-and-borrow", { amountBaseUnits: "1", collateralAmountBaseUnits: "2" }],
    ["repay", { amountBaseUnits: "1" }],
    ["repay-all", { maximumRepayBaseUnits: "2" }],
    ["withdraw-collateral", { amountBaseUnits: "1" }],
    ["close-position", { maximumRepayBaseUnits: "2" }],
  ] as const)("parses the bounded %s intent shape", (operation, amounts) => {
    expect(parseBorrowActionIntent({ marketId, operation, ...amounts })).toEqual({
      marketId,
      operation: operation as BorrowOperation,
      ...amounts,
    });
  });
});
