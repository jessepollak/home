import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseAddress } from "@/shared/chain/hex";
import { EMAIL_REQUEST_ERROR_CODES, isEmailRequestErrorCode, isWalletCode, normalizeReportedEmail, parseEmailRequestClaimResponse, parseEmailRequestErrorResponse, parseEmailRequestReadResponse, parseEmailRequestWrite, parseEmailRequestWriteResponse, type EmailRequestClaimWrite } from "./email-request";

describe("email request contract", () => {
  const normalizedAddress = parseAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")!;
  const address = getAddress(normalizedAddress);

  test("normalizes and validates reported email without accepting malformed or oversized values", () => {
    expect(normalizeReportedEmail("  ALICE@Example.COM  ")).toBe("alice@example.com");
    for (const value of [null, 7, "a@b", "a b@example.com", "a@@example.com", `a@${"b".repeat(316)}.com`]) {
      expect(normalizeReportedEmail(value)).toBeNull();
    }
  });

  test("parses every write kind and rejects unknown kinds, answers and invalid channel combinations", () => {
    expect(parseEmailRequestWrite({ version: 1, kind: "email", channel: "sign_in", email: "  ALICE@Example.COM ", address }))
      .toEqual({ version: 1, kind: "email", channel: "sign_in", email: "alice@example.com", address: normalizedAddress });
    expect(parseEmailRequestWrite({ version: 1, kind: "asked", channel: "share_step", address }))
      .toEqual({ version: 1, kind: "asked", channel: "share_step", address: normalizedAddress });
    expect(parseEmailRequestWrite({ version: 1, kind: "sign_in_capability", result: "refused", walletCode: 4001, address }))
      .toEqual({ version: 1, kind: "sign_in_capability", result: "refused", walletCode: 4001, address: normalizedAddress });
    expect(parseEmailRequestWrite({ version: 1, kind: "answer", channel: "share_step", answer: "not_now", address }))
      .toEqual({ version: 1, kind: "answer", channel: "share_step", answer: "not_now", address: normalizedAddress });
    for (const body of [
      { version: 2, kind: "asked", channel: "share_step", address },
      { version: 1, kind: "asked", channel: "sign_in", address },
      { version: 1, kind: "not_known", address },
      { version: 1, kind: "answer", channel: "sign_in", answer: "not_now", address },
      { version: 1, kind: "answer", channel: "share_step", answer: "shared", address },
      { version: 1, kind: "sign_in_capability", result: "failed", address },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com" },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address: "0x123" },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address: `0x${"g".repeat(40)}` },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address: address.replace(/[A-F]/, (letter) => letter.toLowerCase()) },
      { version: 1, kind: "email", channel: "share_step", email: "bad", address },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address, bundleId: "" },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address, bundleId: "b".repeat(513) },
      { version: 1, kind: "email", channel: "share_step", email: "a@b.com", address, extra: true },
    ]) expect(parseEmailRequestWrite(body)).toBeNull();
  });

  test("accepts only the share step claim write without extra keys", () => {
    const claim: EmailRequestClaimWrite = { version: 1, kind: "claim", channel: "share_step", address: normalizedAddress };
    expect(parseEmailRequestWrite(claim)).toEqual(claim);
    expect(parseEmailRequestWrite({ ...claim, address })).toEqual(claim);
    for (const body of [
      { version: 1, kind: "claim", channel: "sign_in", address },
      { version: 1, kind: "claim" },
      { ...claim, extra: true },
    ]) expect(parseEmailRequestWrite(body)).toBeNull();
  });

  test("requires a valid address on every write kind", () => {
    for (const body of [
      { version: 1, kind: "claim", channel: "share_step" },
      { version: 1, kind: "asked", channel: "share_step" },
      { version: 1, kind: "sign_in_capability", result: "ignored" },
      { version: 1, kind: "answer", channel: "share_step", answer: "failed" },
      { version: 1, kind: "email", channel: "sign_in", email: "a@b.com" },
    ]) {
      expect(parseEmailRequestWrite(body)).toBeNull();
      for (const invalid of [null, "0x123", `0x${"g".repeat(40)}`, 42]) {
        expect(parseEmailRequestWrite({ ...body, address: invalid })).toBeNull();
      }
    }
  });

  test("bounds wallet codes to signed int32", () => {
    for (const code of [2147483647, -2147483648]) {
      expect(isWalletCode(code)).toBe(true);
      expect(parseEmailRequestWrite({ version: 1, kind: "sign_in_capability", result: "refused", walletCode: code, address })).toMatchObject({ walletCode: code });
    }
    for (const code of [2147483648, -2147483649, 1.5, NaN]) {
      expect(isWalletCode(code)).toBe(false);
      expect(parseEmailRequestWrite({ version: 1, kind: "sign_in_capability", result: "refused", walletCode: code, address })).toBeNull();
    }
  });

  test("enforces wallet diagnostics caps", () => {
    for (const walletCode of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4001"]) {
      expect(parseEmailRequestWrite({ version: 1, kind: "sign_in_capability", result: "ignored", walletCode, address })).toBeNull();
    }
    expect(parseEmailRequestWrite({ version: 1, kind: "answer", channel: "sign_in", answer: "declined", walletMessage: "x".repeat(301), address })).toBeNull();
    expect(parseEmailRequestWrite({ version: 1, kind: "answer", channel: "sign_in", answer: "failed", walletMessage: "x".repeat(300), address }))
      .toMatchObject({ answer: "failed", walletMessage: "x".repeat(300) });
  });

  test("parses read and write responses only with the expected version and asked flag", () => {
    expect(parseEmailRequestReadResponse({ version: 1, asked: false })).toEqual({ version: 1, asked: false });
    expect(parseEmailRequestWriteResponse({ version: 1, asked: true })).toEqual({ version: 1, asked: true });
    for (const value of [{ version: 2, asked: true }, { version: 1, asked: "true" }, { version: 1 }]) {
      expect(parseEmailRequestReadResponse(value)).toBeNull();
      expect(parseEmailRequestWriteResponse(value)).toBeNull();
    }
  });

  test("parses claim responses with only the expected version and boolean", () => {
    expect(parseEmailRequestClaimResponse({ version: 1, claimed: true })).toEqual({ version: 1, claimed: true });
    expect(parseEmailRequestClaimResponse({ version: 1, claimed: false })).toEqual({ version: 1, claimed: false });
    for (const value of [
      { version: 2, claimed: true },
      { version: 1, claimed: "true" },
      { version: 1, claimed: true, extra: true },
    ]) expect(parseEmailRequestClaimResponse(value)).toBeNull();
  });

  test("recognizes exactly the email request wire error codes", () => {
    expect(EMAIL_REQUEST_ERROR_CODES).toEqual(["EMAIL_REQUEST_UNSUPPORTED", "EMAIL_REQUEST_UNAVAILABLE", "EMAIL_REQUEST_INVALID"]);
    for (const code of EMAIL_REQUEST_ERROR_CODES) {
      expect(isEmailRequestErrorCode(code)).toBe(true);
      expect(parseEmailRequestErrorResponse({ error: { code } })).toEqual({ error: { code } });
    }
    for (const code of ["EMAIL_REQUEST_UNKNOWN", "UNAUTHENTICATED", null, 1]) {
      expect(isEmailRequestErrorCode(code)).toBe(false);
      expect(parseEmailRequestErrorResponse({ error: { code } })).toBeNull();
    }
    expect(parseEmailRequestErrorResponse(null)).toBeNull();
    expect(parseEmailRequestErrorResponse({ error: null })).toBeNull();
  });
});
