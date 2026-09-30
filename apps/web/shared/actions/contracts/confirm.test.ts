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

const checksummedAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const lowercaseAddress = checksummedAddress.toLowerCase() as `0x${string}`;

describe("confirm action call validation", () => {
  class NonPlainCall {
    to = calls[0].to;
    data = calls[0].data;
    value = calls[0].value;
  }
  const invalidCalls: [string, unknown][] = [
    ["non-hex to", { ...calls[0], to: `0x${"g".repeat(40)}` }],
    ["short to", { ...calls[0], to: "0x1234" }],
    ["bad-checksum mixed-case to", { ...calls[0], to: `0xa${checksummedAddress.slice(3)}` }],
    ["zero-address to", { ...calls[0], to: `0x${"0".repeat(40)}` }],
    ["odd-length data", { ...calls[0], data: "0xABC" }],
    ["non-hex data", { ...calls[0], data: "0xGH" }],
    ["data without 0x prefix", { ...calls[0], data: "1234" }],
    ["negative value", { ...calls[0], value: "-1" }],
    ["decimal value", { ...calls[0], value: "1.5" }],
    ["leading-zero value", { ...calls[0], value: "01" }],
    ["hex value", { ...calls[0], value: "0x1" }],
    ["number value", { ...calls[0], value: 1 }],
    ["value above uint256 maximum", { ...calls[0], value: (BigInt(1) << BigInt(256)).toString() }],
    ["oversized decimal value", { ...calls[0], value: "9".repeat(1000) }],
    ["empty approval assetId", { ...calls[0], approval: { assetId: "", spender: calls[0].to } }],
    ["whitespace approval assetId", { ...calls[0], approval: { assetId: "  ", spender: calls[0].to } }],
    ["overlong approval assetId", { ...calls[0], approval: { assetId: "a".repeat(201), spender: calls[0].to } }],
    ["bad approval spender", { ...calls[0], approval: { assetId: "asset", spender: "0x1234" } }],
    ["zero-address approval spender", { ...calls[0], approval: { assetId: "asset", spender: `0x${"0".repeat(40)}` } }],
    ["null approval", { ...calls[0], approval: null }],
    ["non-record call", null],
    ["non-plain call", new NonPlainCall()],
  ];

  test.each(invalidCalls)("rejects %s in the batch", (_reason, invalidCall) => {
    expect(parseConfirmActionResponse({ calls: [...calls, invalidCall] })).toBeNull();
  });

  test("rejects empty calls because the server never confirms an empty batch", () => {
    expect(parseConfirmActionResponse({ calls: [] })).toBeNull();
  });

  test("lowercases checksummed to and uppercase-hex data", () => {
    expect(parseConfirmActionResponse({ calls: [{ to: checksummedAddress, data: "0xABCD", value: "0" }] })).toEqual({
      calls: [{ to: lowercaseAddress, data: "0xabcd", value: "0" }],
    });
  });

  test("accepts bare 0x data with value for a plain transfer", () => {
    expect(parseConfirmActionResponse({ calls: [{ ...calls[0], data: "0x", value: "123" }] })).toEqual({
      calls: [{ ...calls[0], data: "0x", value: "123" }],
    });
  });

  test("accepts the maximum uint256 decimal value", () => {
    const value = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    expect(parseConfirmActionResponse({ calls: [{ ...calls[0], value }] })).toEqual({ calls: [{ ...calls[0], value }] });
  });

  test("trims approval assetId and lowercases its checksummed spender", () => {
    expect(parseConfirmActionResponse({ calls: [{ ...calls[0], approval: { assetId: "  asset  ", spender: checksummedAddress } }] })).toEqual({
      calls: [{ ...calls[0], approval: { assetId: "asset", spender: lowercaseAddress } }],
    });
  });

  test("drops unknown call and approval keys", () => {
    expect(parseConfirmActionResponse({ calls: [{ ...calls[0], extra: true, approval: undefined }] })).toEqual({ calls });
    expect(parseConfirmActionResponse({ calls: [{ ...calls[0], approval: { assetId: "asset", spender: calls[0].to, extra: true } }] })).toEqual({
      calls: [{ ...calls[0], approval: { assetId: "asset", spender: calls[0].to } }],
    });
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
