import { describe, expect, test } from "bun:test";
import { CONFIRM_CASHOUT_ERRORS, parseConfirmActionErrorResponse, parseConfirmActionResponse, supportsBaseBatchGasHint } from "./confirm";
import { CASHOUT_PREPARE_ERRORS } from "./prepare";

const calls = [{
  to: "0x1111111111111111111111111111111111111111" as const,
  data: "0x1234" as const,
  value: "0",
}];

test("Base batch gas hint requires independent intermediate token calls", () => {
  const approve = { data: `0x095ea7b3${"0".repeat(64)}${"f".repeat(64)}` };
  const upperSelectorApprove = { data: `0x095EA7B3${"A".repeat(128)}` };
  const supplyCollateral = { data: "0x238d6579" };
  const borrow = { data: "0x50d8cd4b" };
  const swap = { data: "0x1234" };

  expect(supportsBaseBatchGasHint([])).toBe(false);
  expect(supportsBaseBatchGasHint([supplyCollateral])).toBe(true);
  expect(supportsBaseBatchGasHint([supplyCollateral, borrow])).toBe(true);
  expect(supportsBaseBatchGasHint([approve, upperSelectorApprove, swap])).toBe(true);
  expect(supportsBaseBatchGasHint([approve, supplyCollateral, borrow])).toBe(false);
  expect(supportsBaseBatchGasHint([approve, upperSelectorApprove, supplyCollateral, borrow])).toBe(false);
  expect(supportsBaseBatchGasHint([approve, { data: "0x095ea7b3" }, swap])).toBe(false);
  expect(supportsBaseBatchGasHint([approve, { data: `${approve.data}00` }, swap])).toBe(false);
  const transfer = { data: `0xa9059cbb${"0".repeat(24)}${"1".repeat(40)}${"0".repeat(63)}1` };
  expect(supportsBaseBatchGasHint([approve, transfer, swap])).toBe(true);
  expect(supportsBaseBatchGasHint([transfer, approve, swap])).toBe(true);
  expect(supportsBaseBatchGasHint([approve, transfer, approve, swap])).toBe(true);
  expect(supportsBaseBatchGasHint([approve, swap, transfer])).toBe(false);
  expect(supportsBaseBatchGasHint([swap, transfer])).toBe(true);
  expect(supportsBaseBatchGasHint([swap, transfer, swap])).toBe(false);
  expect(supportsBaseBatchGasHint([approve, { data: `${transfer.data}00` }, swap])).toBe(false);
  expect(supportsBaseBatchGasHint([approve, { data: transfer.data.replace(/^0xa9059cbb0/, "0xa9059cbb1") }, swap])).toBe(false);
});

describe("confirm action response parser", () => {
  test("accepts an absent or valid optional decimal batch gas limit", () => {
    expect(parseConfirmActionResponse({ calls })).toEqual({ calls });
    expect(parseConfirmActionResponse({ calls, batchGasLimit: "2000000" })).toEqual({
      calls,
      batchGasLimit: "2000000",
    });
  });

  test("rejects malformed, zero, and out-of-range batch gas limits", () => {
    for (const batchGasLimit of ["0", "01", "0x10", "1.5", "2000001", 100000]) {
      expect(parseConfirmActionResponse({ calls, batchGasLimit })).toBeNull();
    }
  });
});

describe("confirm action error contract", () => {
  test("declares the cash-out region failures shared with prepare", () => {
    expect(CONFIRM_CASHOUT_ERRORS).toEqual({
      unavailable: CASHOUT_PREPARE_ERRORS.unavailable,
      "settings-unavailable": CASHOUT_PREPARE_ERRORS["settings-unavailable"],
    });
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_UNAVAILABLE", message: "x" } })).toEqual({ error: { code: "CASHOUT_UNAVAILABLE", message: "x" } });
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_SETTINGS_UNAVAILABLE", message: "y" } })?.error.code).toBe("CASHOUT_SETTINGS_UNAVAILABLE");
  });

  test("rejects codes confirm never returns and malformed bodies", () => {
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_ORDER_IN_FLIGHT", message: "x" } })).toBeNull();
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_UNAVAILABLE" } })).toBeNull();
    expect(parseConfirmActionErrorResponse({ code: "CASHOUT_UNAVAILABLE", message: "x" })).toBeNull();
    expect(parseConfirmActionErrorResponse({ calls })).toBeNull();
  });
});
