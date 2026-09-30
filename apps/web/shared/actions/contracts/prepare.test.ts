import { describe, expect, test } from "bun:test";
import { cashoutPrepareErrorResponse, isCashoutPrepareErrorCode, parsePrepareActionErrorResponse, validPrepared } from "./prepare";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

const address = "0x1111111111111111111111111111111111111111" as const;
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const paymaster = "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" as const;
const session: VerifiedAccountSession = { user: { subject: "subject" }, smartAccount: { address, chainId: 8453 }, accountProvider: "cdp-embedded" };
const fee = { payment: "usdc", token, paymaster, maxFeeBaseUnits: "20000", decimals: 6 };
const approval = { to: token, value: "0", data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` };
const prepared = { id: "action", owner: { subject: "subject", address, accountProvider: "cdp-embedded" }, calls: [approval], amounts: [], warnings: [], networkFee: fee };

describe("prepared network fee validation", () => {
  test("accepts a zero-amount card allowance only with matching typed metadata", () => {
    const metadata = { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
      token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender: "0x65bf8b55eedef53c094e40003a03390de744df33",
      allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "0", maximumBaseUnits: "100000000", source: { blockNumber: "100" } };
    const card = { ...prepared, kind: "card-allowance", metadata };
    expect(validPrepared(card, session)).toBe(true);
    expect(validPrepared({ ...card, metadata: undefined }, session)).toBe(false);
    expect(validPrepared({ ...card, amounts: [{ assetId: "usdc" }] }, session)).toBe(false);
    expect(validPrepared({ ...card, kind: "send" }, session)).toBe(false);
  });
  test("accepts native and absent fee and a matching USDC approval", () => {
    expect(validPrepared(prepared, session)).toBe(true);
    expect(validPrepared({ ...prepared, networkFee: { payment: "native" }, calls: [] }, session)).toBe(true);
    expect(validPrepared({ ...prepared, networkFee: undefined, calls: [] }, session)).toBe(true);
  });

  test("rejects malformed arrays and non-record leading ERC20 approvals", () => {
    for (const field of ["calls", "amounts", "warnings"]) {
      for (const malformed of [{}, "not-an-array"]) {
        expect(validPrepared({ ...prepared, [field]: malformed }, session)).toBe(false);
      }
    }
    expect(validPrepared({ ...prepared, calls: ["not-a-call"] }, session)).toBe(false);
  });

  test("rejects invalid fee payload and a missing or mismatched leading approval", () => {
    expect(validPrepared({ ...prepared, networkFee: { ...fee, maxFeeBaseUnits: "0" } }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, to: paymaster }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${paymaster.slice(2).padStart(64, "0")}${BigInt(20_001).toString(16).padStart(64, "0")}` }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: approval.data.replace("095ea7b3", "a9059cbb") }] }, session)).toBe(false);
    expect(validPrepared({ ...prepared, calls: [{ ...approval, data: `0x095ea7b3${address.slice(2).padStart(64, "0")}${BigInt(20_000).toString(16).padStart(64, "0")}` }] }, session)).toBe(false);
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
});
