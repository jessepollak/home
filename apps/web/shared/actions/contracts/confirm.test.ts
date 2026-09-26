import { describe, expect, test } from "bun:test";
import { parseConfirmActionResponse, supportsBaseBatchGasHint } from "./confirm";

const calls = [{
  to: "0x1111111111111111111111111111111111111111" as const,
  data: "0x1234" as const,
  value: "0",
}];

test("Base batch gas hint requires every intermediate call to be an exact token approval", () => {
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
