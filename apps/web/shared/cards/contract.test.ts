import { expect, test } from "bun:test";
import { parseCardEnrollmentResponse, parseCardRevealRequest, parseCardRevealResponse, parseCardsResponse, parseCardWriteError, parseCardWriteResponse } from "./contract";
const id = "11111111-1111-4111-8111-111111114821";
const response = { version: 2, state: "active", cards: [{ id, status: "active", last4: "4821" }],
  provenance: { program: "bridge", account: "available", cards: "available", fetchedAt: "2026-10-06T00:00:00Z" } };
test("cards v2 parses UUIDs and neutral provenance, rejecting the old contract", () => {
  expect<unknown>(parseCardsResponse(response)).toEqual(response);
  expect(parseCardsResponse({ ...response, version: 1 })).toBeNull();
  expect(parseCardsResponse({ ...response, cards: [{ ...response.cards[0], id: "ic_fixture" }] })).toBeNull();
  for (const value of [null, 1, ["active"], { toString: () => "active" }]) {
    expect(parseCardsResponse({ ...response, state: value })).toBeNull();
    expect(parseCardsResponse({ ...response, cards: [{ ...response.cards[0], status: value }] })).toBeNull();
    expect(parseCardsResponse({ ...response, provenance: { ...response.provenance, account: value } })).toBeNull();
    expect(parseCardWriteError({ version: 2, error: { code: value } })).toBeNull();
  }
});
test("enrollment next is complete or a closed HTTPS host redirect", () => {
  expect(parseCardEnrollmentResponse({ version: 2, next: { kind: "complete" } })).not.toBeNull();
  expect(parseCardEnrollmentResponse({ version: 2, next: { kind: "redirect", url: "https://bridge.withpersona.com/inquiry" } })).not.toBeNull();
  for (const url of ["http://bridge.withpersona.com/", "https://wrong.example/", "https://user:pass@bridge.withpersona.com/", "https://bridge.withpersona.com/#fragment", "https://bridge.withpersona.com:444/"])
    expect(parseCardEnrollmentResponse({ version: 2, next: { kind: "redirect", url } })).toBeNull();
});
test.each(["prepare", "grant"] as const)("reveal %s has a strict discriminated request and response", (step) => {
  const request = step === "prepare" ? { method: "stripe-issuing-elements", step } : { method: "stripe-issuing-elements", step, nonce: "nonce_synthetic123" };
  const grant = step === "prepare" ? { ...request, issuingCard: "ic_fixture" } : { ...request, issuingCard: "ic_fixture", ephemeralKeySecret: "ek_test_synthetic123456" };
  expect<unknown>(parseCardRevealRequest(request)).toEqual(request);
  expect(parseCardRevealResponse({ version: 2, cardId: id, grant })).not.toBeNull();
  expect(parseCardRevealRequest({ ...request, extra: true })).toBeNull();
  expect(parseCardRevealResponse({ version: 2, cardId: "ic_fixture", grant })).toBeNull();
  expect(parseCardRevealResponse({ version: 2, cardId: id, grant: { ...grant, issuingCard: "other" } })).toBeNull();
});
test("invalid envelopes, UUID writes, and malformed reveal requests fail closed", () => {
  for (const parse of [parseCardsResponse, parseCardEnrollmentResponse, parseCardWriteResponse, parseCardWriteError, parseCardRevealResponse]) {
    for (const invalid of [null, [], {}, { ...response, version: 1 }]) expect(parse(invalid)).toBeNull();
  }
  expect(parseCardWriteResponse({ version: 2, card: { id, status: "frozen" } })).not.toBeNull();
  expect(parseCardWriteResponse({ version: 2, card: { id, status: "restricted" } })).toBeNull();
  for (const input of [{ nonce: "nonce_synthetic123" }, { method: "stripe-issuing-elements", step: "grant", nonce: "short" },
    { method: "stripe-issuing-elements", step: "prepare", nonce: "nonce_synthetic123" }]) expect(parseCardRevealRequest(input)).toBeNull();
});
