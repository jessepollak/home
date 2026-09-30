import { describe, expect, test } from "bun:test";
import { CARD_ALLOWANCE_PREPARE_ERRORS, parseCardAllowanceMetadata, parseCardAllowancePrepareParams, parseCardSpendingError, parseCardSpendingResponse } from "./allowance-contract";

const spender = "0x65bf8b55eedef53c094e40003a03390de744df33";
const metadata = { product: "card", operation: "set-allowance", provider: "bridge", mode: "production",
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", spender,
  allowanceBaseUnits: "25000000", previousAllowanceBaseUnits: "0", maximumBaseUnits: "100000000", source: { blockNumber: "100" } } as const;

const spending = { version: 1 as const, status: "available" as const, setEnabled: true, spender: spender as `0x${string}`, walletBaseUnits: "10", allowanceBaseUnits: "5", availableBaseUnits: "5",
  retired: [], blockNumber: "100", fetchedAt: "2026-09-28T12:00:00.000Z" };

describe("card spending response contract", () => {
  test("accepts the exact versioned status union", () => {
    expect(parseCardSpendingResponse(spending)).toEqual(spending);
    expect(parseCardSpendingResponse({ ...spending, setEnabled: false })).toEqual({ ...spending, setEnabled: false });
    expect(parseCardSpendingResponse({ version: 1, status: "not-configured" })).toEqual({ version: 1, status: "not-configured" });
    expect(parseCardSpendingResponse({ version: 1, status: "unavailable", fetchedAt: spending.fetchedAt })).toBeTruthy();
  });
  test("accepts only validated retired allowances and the versioned no-wallet error", () => {
    expect(parseCardSpendingResponse({ ...spending, retired: [{ spender: "0x4444444444444444444444444444444444444444", allowanceBaseUnits: "25" }] })).toBeTruthy();
    expect(parseCardSpendingResponse({ ...spending, retired: [{ spender: "0x4444444444444444444444444444444444444444", allowanceBaseUnits: "-1" }] })).toBeNull();
    expect(parseCardSpendingResponse({ ...spending, retired: [{ spender: spending.spender, allowanceBaseUnits: "5" }] })).toBeNull();
    expect(parseCardSpendingError({ version: 1, error: { code: "CARDS_UNAVAILABLE" } })).toEqual({ version: 1, error: { code: "CARDS_UNAVAILABLE" } });
    expect(parseCardSpendingError({ version: 1, error: { code: "OTHER" } })).toBeNull();
  });
  test.each([null, { ...spending, setEnabled: undefined }, { ...spending, setEnabled: "false" }, { ...spending, version: 2 }, { ...spending, status: "other" }, { ...spending, availableBaseUnits: "6" },
    { ...spending, walletBaseUnits: "3" }, { ...spending, allowanceBaseUnits: "01" }, { ...spending, blockNumber: "-1" },
    { ...spending, walletBaseUnits: "-1" }, { ...spending, availableBaseUnits: "1.1" }, { ...spending, spender: spender.toUpperCase() },
    { ...spending, fetchedAt: "invalid" }, { ...spending, extra: true }, { version: 1, status: "not-configured", fetchedAt: spending.fetchedAt },
    { version: 1, status: "unavailable" }])("rejects malformed spending response %p", (value) => {
    expect(parseCardSpendingResponse(value)).toBeNull();
  });
});

describe("card allowance shared contract", () => {
  test("accepts exact versioned set and revoke parameters", () => {
    expect(parseCardAllowancePrepareParams({ version: 1, operation: "set", allowanceBaseUnits: "25000000" })).toEqual({ version: 1, operation: "set", allowanceBaseUnits: "25000000" });
    expect(parseCardAllowancePrepareParams({ version: 1, operation: "revoke", spender })).toEqual({ version: 1, operation: "revoke", spender });
  });
  test.each([null, {}, { version: 2, operation: "set", allowanceBaseUnits: "1" },
    { version: 1, operation: "set", allowanceBaseUnits: "01" }, { version: 1, operation: "set", allowanceBaseUnits: "-1" },
    { version: 1, operation: "set", allowanceBaseUnits: "1.5" }, { version: 1, operation: "revoke", spender: "invalid" },
    { version: 1, operation: "revoke", spender, allowanceBaseUnits: "0" },
    { version: 1, operation: "set", allowanceBaseUnits: "1", spender }])("rejects invalid request %p", (value) => {
    expect(parseCardAllowancePrepareParams(value)).toBeNull();
  });
  test("declares versioned prepare errors with distinct statuses", () => {
    expect(CARD_ALLOWANCE_PREPARE_ERRORS).toEqual({ unavailable: { code: "CARD_ALLOWANCE_UNAVAILABLE", status: 503 },
      "not-ready": { code: "CARD_ALLOWANCE_NOT_READY", status: 409 }, invalid: { code: "CARD_ALLOWANCE_INVALID", status: 400 },
      unchanged: { code: "CARD_ALLOWANCE_UNCHANGED", status: 409 } });
  });
  test("rejects malformed metadata but accepts a zero standalone revoke", () => {
    expect(parseCardAllowanceMetadata(metadata)).toEqual(metadata);
    expect(parseCardAllowanceMetadata({ ...metadata, operation: "revoke-allowance", allowanceBaseUnits: "0", maximumBaseUnits: null })).toBeTruthy();
    for (const value of [{ ...metadata, token: "0x2222222222222222222222222222222222222222" },
      { ...metadata, spender: "0x65bf8b55EEDef53C094E40003a03390De744DF33" },
      { ...metadata, operation: "revoke-allowance", allowanceBaseUnits: "0" },
      { ...metadata, operation: "set-allowance", allowanceBaseUnits: "0" },
      { ...metadata, maximumBaseUnits: null }, { ...metadata, source: { blockNumber: "-1" } }]) {
      expect(parseCardAllowanceMetadata(value)).toBeNull();
    }
  });
});
