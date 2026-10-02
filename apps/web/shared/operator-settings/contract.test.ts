import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseAuditListResponse, parsePutSettingsRequest } from "./contract";

test("PUT request canonicalizes a checksummed operator and rejects malformed operators", () => {
  const operator = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const input = { version: 1, expectedRevision: 0, value: { email: null, url: null }, operator };
  expect(String(parsePutSettingsRequest(input)?.operator)).toBe(operator.toLowerCase());
  for (const bad of [operator.replace("A", "a"), "0x1234", `0x${"g".repeat(40)}`]) {
    expect(parsePutSettingsRequest({ ...input, operator: bad })).toBeNull();
  }
});

test("audit response canonicalizes checksummed actor and rejects malformed actors", () => {
  const actor = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const entry = { id: "1", occurredAt: "2026-09-25T12:00:00Z", actor, action: "customer.read", target: { kind: "customer", id: "one" }, purpose: "support" };
  const input = { version: 1, entries: [entry], nextCursor: null };
  expect(String(parseAuditListResponse(input)?.entries[0]?.actor)).toBe(actor.toLowerCase());
  for (const bad of [actor.replace("A", "a"), "0x1234", "0xnothex"]) {
    expect(parseAuditListResponse({ ...input, entries: [{ ...entry, actor: bad }] })).toBeNull();
  }
});
