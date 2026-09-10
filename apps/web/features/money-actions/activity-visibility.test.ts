import { describe, expect, test } from "bun:test";
import type { MoneyActionOperationStatus } from "./types";
import {
  hasOnchainExecutionReference,
  isActivityVisibleMoneyAction,
  visibleActivityMoneyActions,
} from "./activity-visibility";

const hash = `0x${"a".repeat(64)}`;

function operation(
  status: MoneyActionOperationStatus,
  refs: { transactionHash?: string; userOperationHash?: string } = {},
) {
  return { status, ...refs };
}

describe("Activity money-action visibility", () => {
  test("hides Rejected, Expired, and failed-without-chain-reference", () => {
    expect(isActivityVisibleMoneyAction(operation("rejected"))).toBe(false);
    expect(isActivityVisibleMoneyAction(operation("expired"))).toBe(false);
    expect(isActivityVisibleMoneyAction(operation("failed"))).toBe(false);
    expect(isActivityVisibleMoneyAction(operation("failed", { transactionHash: "" }))).toBe(false);
    expect(isActivityVisibleMoneyAction(operation("failed", { userOperationHash: "0xzz" }))).toBe(false);
  });

  test("keeps confirmed success and failed-onchain with a transaction or user-operation hash", () => {
    expect(isActivityVisibleMoneyAction(operation("confirmed", { transactionHash: hash }))).toBe(true);
    expect(isActivityVisibleMoneyAction(operation("failed", { transactionHash: hash }))).toBe(true);
    expect(isActivityVisibleMoneyAction(operation("failed", { userOperationHash: hash }))).toBe(true);
    expect(hasOnchainExecutionReference(operation("failed", { transactionHash: hash }))).toBe(true);
  });

  test("keeps in-flight statuses that are not pre-chain terminals", () => {
    for (const status of ["prepared", "submitting", "submitted", "included", "unknown"] as const) {
      expect(isActivityVisibleMoneyAction(operation(status))).toBe(true);
    }
  });

  test("filters a mixed Activity page without mutating hidden rows", () => {
    const rejected = operation("rejected");
    const failedOnchain = operation("failed", { transactionHash: hash });
    const confirmed = operation("confirmed", { transactionHash: hash });
    expect(visibleActivityMoneyActions([rejected, failedOnchain, confirmed])).toEqual([
      failedOnchain,
      confirmed,
    ]);
    expect(rejected.status).toBe("rejected");
  });
});
