import { describe, expect, test } from "bun:test";
import { CONFIRM_CASHOUT_ERRORS, baseBatchGasLimits, isConfirmActionErrorCode, parseConfirmActionErrorResponse, parseConfirmActionResponse } from "./confirm";
import { CASHOUT_PREPARE_ERRORS } from "./prepare";

const calls = [{
  to: "0x1111111111111111111111111111111111111111" as const,
  data: "0x1234" as const,
  value: "0",
}];

test.each([1, 2, 3, 4, 5, 6, 7, 8])("Base gas overrides preserve the aggregate budget for %s calls", (count) => {
  for (const budget of [count, 257_391, 2_000_000]) {
    const limits = baseBatchGasLimits(String(budget), count);
    if (!limits) throw new Error("Missing gas overrides");
    expect(limits).toHaveLength(count);
    expect(limits.every((limit) => BigInt(limit) > BigInt(0))).toBe(true);
    expect(limits.reduce((sum, limit) => sum + BigInt(limit), BigInt(0))).toBe(BigInt(budget));
  }
});

test("Base gas overrides reject invalid or insufficient budgets and unsupported batch sizes", () => {
  for (const budget of ["0", "2", "01", "0x10", "1.5", "-1", "2000001"]) {
    expect(baseBatchGasLimits(budget, 3)).toBeNull();
  }
  for (const count of [0, -1, 9, 1.5, NaN, Infinity]) {
    expect(baseBatchGasLimits("150000", count)).toBeNull();
  }
});

test("confirm action error contract accepts declared codes and rejects malformed or unknown responses", () => {
  for (const code of ["INVALID_ACTION", "ACTION_NOT_FOUND", "ACTION_EXPIRED", "TRADE_ADMISSION_REVOKED", "TRADE_STOCK_RESTRICTED", "INVALID_TRADE_SIGNATURE", "PRODUCT_NOT_OFFERED"] as const) {
    expect(isConfirmActionErrorCode(code)).toBe(true);
    expect(parseConfirmActionErrorResponse({ error: { code, message: "Unavailable" } })).toEqual({ error: { code, message: "Unavailable" } });
  }
  for (const value of [null, [], {}, { error: null }, { error: { code: "UNKNOWN", message: "Unavailable" } },
    { error: { code: "ACTION_EXPIRED", message: 42 } }]) {
    expect(parseConfirmActionErrorResponse(value)).toBeNull();
  }
  expect(isConfirmActionErrorCode("UNKNOWN")).toBe(false);
  expect(isConfirmActionErrorCode(null)).toBe(false);
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
    expect(parseConfirmActionErrorResponse({ error: { code: "CARD_ALLOWANCE_UNAVAILABLE", message: "Prepare again." } })).toEqual({ error: { code: "CARD_ALLOWANCE_UNAVAILABLE", message: "Prepare again." } });
  });

  test("rejects codes confirm never returns and malformed bodies", () => {
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_ORDER_IN_FLIGHT", message: "x" } })).toBeNull();
    expect(parseConfirmActionErrorResponse({ error: { code: "CASHOUT_UNAVAILABLE" } })).toBeNull();
    expect(parseConfirmActionErrorResponse({ code: "CASHOUT_UNAVAILABLE", message: "x" })).toBeNull();
    expect(parseConfirmActionErrorResponse({ calls })).toBeNull();
  });
});
