import { describe, expect, test } from "bun:test";
import {
  parseCardEnrollmentResponse, parseCardEphemeralKeyRequest, parseCardEphemeralKeyResponse,
  parseCardsResponse, parseCardWriteError, parseCardWriteResponse,
} from "./contract";

const response = {
  version: 1, state: "active", cards: [{ id: "ic_123", status: "active", last4: "1234" }],
  provenance: { bridge: "available", stripe: "available", fetchedAt: "2026-09-01T12:00:00.000Z" },
};

describe("card shared schemas", () => {
  test("retains valid original response objects and nested extra fields", () => {
    const input = { ...response, state: "active", extra: true,
      cards: [{ ...response.cards[0], status: "active", extra: true }],
      provenance: { ...response.provenance, bridge: "available", extra: true } };
    expect(Object.is(parseCardsResponse(input), input)).toBe(true);
    const error = { version: 1, error: { code: "CROSS_ORIGIN", extra: true }, extra: true };
    expect(Object.is(parseCardWriteError(error), error)).toBe(true);
  });
  test.each([null, undefined, 1, true, {}, ["active"], { toString: () => "active" }].map((value) => ({ value })))("rejects non-string card enums: %p", ({ value }) => {
    expect(parseCardsResponse({ ...response, state: value })).toBeNull();
    expect(parseCardsResponse({ ...response, cards: [{ ...response.cards[0], status: value }] })).toBeNull();
    expect(parseCardsResponse({ ...response, provenance: { ...response.provenance, bridge: value, stripe: value } })).toBeNull();
    expect(parseCardWriteError({ version: 1, error: { code: value } })).toBeNull();
  });
  test("rejects enum-coercible sources and write error codes", () => {
    for (const value of [["available"], { toString: () => "available" }]) {
      expect(parseCardsResponse({ ...response, provenance: { ...response.provenance, bridge: value } })).toBeNull();
      expect(parseCardsResponse({ ...response, provenance: { ...response.provenance, stripe: value } })).toBeNull();
    }
    for (const code of [["CROSS_ORIGIN"], { toString: () => "CROSS_ORIGIN" }]) {
      expect(parseCardWriteError({ version: 1, error: { code } })).toBeNull();
    }
  });
  test("retains valid enrollment, write and ephemeral responses including extra fields", () => {
    const enrollment = { version: 1, kycUrl: "https://bridge.withpersona.com/inquiry", extra: true };
    expect(Object.is(parseCardEnrollmentResponse(enrollment), enrollment)).toBe(true);
    const write = { version: 1, card: { id: "ic_123", status: "frozen", extra: true }, extra: true };
    expect(Object.is(parseCardWriteResponse(write), write)).toBe(true);
    const ephemeral = { version: 1, cardId: "ic_123", ["ephemeral" + "KeySecret"]: "ek_test_synthetic123456", extra: true };
    expect(Object.is(parseCardEphemeralKeyResponse(ephemeral), ephemeral)).toBe(true);
  });
  test("nonce requests accept only the one valid field and return a new object", () => {
    const input = { nonce: "nonce_synthetic123" };
    expect(parseCardEphemeralKeyRequest(input)).toEqual(input);
    expect(parseCardEphemeralKeyRequest(input)).not.toBe(input);
    for (const invalid of [null, [], {}, { nonce: "short" }, { nonce: "nonce_synthetic123", extra: true }]) {
      expect(parseCardEphemeralKeyRequest(invalid)).toBeNull();
    }
  });
  test("rejects invalid response envelopes and malformed nested card fields", () => {
    for (const parse of [parseCardsResponse, parseCardEnrollmentResponse, parseCardWriteResponse, parseCardWriteError, parseCardEphemeralKeyResponse]) {
      for (const invalid of [null, [], {}, { ...response, version: 2 }]) expect(parse(invalid)).toBeNull();
    }
    for (const invalid of [
      { ...response, state: "unknown" },
      { ...response, cards: [{ id: "bad", status: "active", last4: "1234" }] },
      { ...response, cards: [{ id: "ic_123", status: "active", last4: 1234 }] },
      { ...response, provenance: { ...response.provenance, fetchedAt: "not a date" } },
    ]) expect(parseCardsResponse(invalid)).toBeNull();
    expect(parseCardWriteResponse({ version: 1, card: { id: "ic_123", status: ["active"] } })).toBeNull();
    expect(parseCardWriteError({ version: 1, error: { code: "UNKNOWN" } })).toBeNull();
    for (const kycUrl of ["http://bridge.withpersona.com/", "https://wrong.example/", "https://user:pass@bridge.withpersona.com/", "https://bridge.withpersona.com/#fragment"])
      expect(parseCardEnrollmentResponse({ version: 1, kycUrl })).toBeNull();
  });
});
