import { describe, expect, test } from "bun:test";
import { cashoutPrepareErrorResponse, isCashoutPrepareErrorCode, parsePrepareActionErrorResponse, parseProductNotOfferedPrepareErrorResponse, parsePreparedAction } from "./prepare";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const address = "0x1111111111111111111111111111111111111111" as const;
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const paymaster = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" as const;
const session: VerifiedAccountSession = { user: { subject: "subject" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
const fee = { payment: "usdc", token, paymaster, maxFeeBaseUnits: "20000", decimals: 6 };
const approval = { to: token, value: "0", data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` };
const prepared = { id: "action", owner: { subject: "subject", address, accountProvider: "cdp-embedded" }, calls: [approval], amounts: [], warnings: [], networkFee: fee };

class NonPlainCall {
  to = address;
  data = "0x";
  value = "0";
}

const invalidCalls: [string, unknown][] = [
  ["non-address to", { ...approval, to: "not-an-address" }],
  ["short to", { ...approval, to: "0x1234" }],
  ["zero to", { ...approval, to: `0x${"0".repeat(40)}` }],
  ["odd-length data", { ...approval, data: "0xABC" }],
  ["non-hex data", { ...approval, data: "0xGH" }],
  ["uppercase data prefix", { ...approval, data: "0XABCD" }],
  ["negative value", { ...approval, value: "-1" }],
  ["non-decimal value", { ...approval, value: "0x1" }],
  ["value above uint256", { ...approval, value: (BigInt(1) << BigInt(256)).toString() }],
  ["zero approval spender", { ...approval, approval: { assetId: "usdc", spender: `0x${"0".repeat(40)}` } }],
  ["empty approval assetId", { ...approval, approval: { assetId: " ", spender: address } }],
  ["non-plain call", new NonPlainCall()],
];

describe("prepared action call validation", () => {
  test.each(invalidCalls)("rejects %s in any batch position without a network fee", (_reason, call) => {
    expect(parsePreparedAction({ ...prepared, networkFee: undefined, calls: [approval, call] }, session)).toBeNull();
  });
  test("rejects empty batches with absent and native fees", () => {
    for (const networkFee of [undefined, { payment: "native" }]) {
      expect(parsePreparedAction({ ...prepared, networkFee, calls: [] }, session)).toBeNull();
    }
  });
  test("canonicalizes calls and approvals without changing other prepared fields", () => {
    const calls = [{ to: token, data: "0xABCD", value: "0", approval: { assetId: " usdc ", spender: paymaster } }];
    const input = { ...prepared, networkFee: undefined, calls };
    expect<unknown>(parsePreparedAction(input, session)).toEqual({ ...input,
      calls: [{ to: token.toLowerCase(), data: "0xabcd", value: "0", approval: { assetId: "usdc", spender: paymaster.toLowerCase() } }] });
    expect(input.calls).toEqual(calls);
  });
  test("accepts bare 0x data with a nonzero value", () => {
    const calls = [{ to: address, data: "0x" as const, value: "123" }];
    expect(parsePreparedAction({ ...prepared, networkFee: undefined, calls }, session)?.calls).toEqual(calls);
  });
});

describe("prepared network fee validation", () => {
  test("accepts a zero-amount card allowance only with matching typed metadata", () => {
    const metadata = { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x65bf8b55eedef53c094e40003a03390de744df33",
      allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "0", maximumBaseUnits: "100000000", source: { blockNumber: "100" } };
    const card = { ...prepared, kind: "card-allowance", metadata };
    expect(parsePreparedAction(card, session)).not.toBeNull();
    expect(parsePreparedAction({ ...card, metadata: undefined }, session)).toBeNull();
    expect(parsePreparedAction({ ...card, amounts: [{ assetId: "usdc" }] }, session)).toBeNull();
    expect(parsePreparedAction({ ...card, kind: "send" }, session)).toBeNull();
  });
  test("accepts native and absent fee and a matching USDC approval", () => {
    expect(String(parsePreparedAction(prepared, session)?.calls[0]?.to)).toBe(token.toLowerCase());
    expect(parsePreparedAction({ ...prepared, networkFee: { payment: "native" } }, session)).not.toBeNull();
    expect(parsePreparedAction({ ...prepared, networkFee: undefined }, session)).not.toBeNull();
  });

  test("rejects malformed arrays and non-record leading ERC20 approvals", () => {
    for (const field of ["calls", "amounts", "warnings"]) {
      for (const malformed of [{}, "not-an-array"]) {
        expect(parsePreparedAction({ ...prepared, [field]: malformed }, session)).toBeNull();
      }
    }
    expect(parsePreparedAction({ ...prepared, calls: ["not-a-call"] }, session)).toBeNull();
  });

  test("rejects invalid fee payload and a missing or mismatched leading approval", () => {
    expect(parsePreparedAction({ ...prepared, networkFee: { ...fee, maxFeeBaseUnits: "0" } }, session)).toBeNull();
    expect(parsePreparedAction({ ...prepared, calls: [] }, session)).toBeNull();
    expect(parsePreparedAction({ ...prepared, calls: [{ ...approval, to: paymaster }] }, session)).toBeNull();
    expect(parsePreparedAction({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_001).toString(16).padStart(64, "0")}` }] }, session)).toBeNull();
    expect(parsePreparedAction({ ...prepared, calls: [{ ...approval, data: approval.data.replace("095ea7b3", "a9059cbb") }] }, session)).toBeNull();
    expect(parsePreparedAction({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${address.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` }] }, session)).toBeNull();
  });
});

describe("cashout prepare error contract", () => {
  test("maps each reason to its wire code and status", () => {
    expect(cashoutPrepareErrorResponse("settings-unavailable")).toEqual({ code: "CASHOUT_SETTINGS_UNAVAILABLE", status: 503 });
    expect(cashoutPrepareErrorResponse("unavailable")).toEqual({ code: "CASHOUT_UNAVAILABLE", status: 502 });
    expect(cashoutPrepareErrorResponse("not-withdrawable")).toEqual({ code: "CASHOUT_NOT_WITHDRAWABLE", status: 422 });
    expect(cashoutPrepareErrorResponse("duplicate-unknown")).toEqual({ code: "CASHOUT_DUPLICATE_UNKNOWN", status: 409 });
    expect(cashoutPrepareErrorResponse("order-in-flight")).toEqual({ code: "CASHOUT_ORDER_IN_FLIGHT", status: 409 });
    expect(cashoutPrepareErrorResponse("invalid-input")).toEqual({ code: "CASHOUT_INVALID_INPUT", status: 400 });
  });

  test("parses a cashout prepare error and rejects unknown or malformed responses", () => {
    expect(parsePrepareActionErrorResponse({ error: { code: "CASHOUT_SETTINGS_UNAVAILABLE", message: "Try again shortly." } }))
      .toEqual({ error: { code: "CASHOUT_SETTINGS_UNAVAILABLE", message: "Try again shortly." } });
    expect(isCashoutPrepareErrorCode("CASHOUT_ORDER_IN_FLIGHT")).toBe(true);
    expect(isCashoutPrepareErrorCode("CASHOUT_IN_PROGRESS")).toBe(false);
    expect(isCashoutPrepareErrorCode("ACTION_PREPARE_UNAVAILABLE")).toBe(false);
    expect(parsePrepareActionErrorResponse({ error: { code: "CASHOUT_IN_PROGRESS", message: "x" } })).toBeNull();
    expect(parsePrepareActionErrorResponse({ error: { code: "CASHOUT_UNAVAILABLE" } })).toBeNull();
    expect(parsePrepareActionErrorResponse({ code: "CASHOUT_UNAVAILABLE", message: "x" })).toBeNull();
    expect(parsePrepareActionErrorResponse({ error: { code: "CARD_ALLOWANCE_NOT_READY", message: "An eligible card is required." } }))
      .toEqual({ error: { code: "CARD_ALLOWANCE_NOT_READY", message: "An eligible card is required." } });
  });

  test("parses a product-not-offered prepare error and rejects malformed responses", () => {
    expect(parseProductNotOfferedPrepareErrorResponse({ error: { code: "PRODUCT_NOT_OFFERED", message: "This is no longer offered." } }))
      .toEqual({ error: { code: "PRODUCT_NOT_OFFERED", message: "This is no longer offered." } });
    expect(parseProductNotOfferedPrepareErrorResponse({ error: { code: "PRODUCT_NOT_OFFERED" } })).toBeNull();
    expect(parseProductNotOfferedPrepareErrorResponse({ error: { code: "CASHOUT_UNAVAILABLE", message: "x" } })).toBeNull();
    expect(parseProductNotOfferedPrepareErrorResponse({ code: "PRODUCT_NOT_OFFERED", message: "x" })).toBeNull();
  });
});
