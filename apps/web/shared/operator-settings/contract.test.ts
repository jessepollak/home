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

test("audit parsing accepts the credential actions and rejects their wrong shapes", () => {
  const actor = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  const entry = { id: "2", occurredAt: "2026-09-25T12:00:00Z", actor, action: "support.credential.update", target: { kind: "settings", id: "support-assistant-key" }, before: { last4: null }, after: { last4: "abcd" } };
  const input = { version: 1, entries: [entry, { ...entry, action: "support.credential.delete", before: { last4: "abcd" }, after: { last4: null } }], nextCursor: null };
  expect(parseAuditListResponse(input)?.entries.map((parsed) => parsed.action)).toEqual(["support.credential.update", "support.credential.delete"]);
  for (const bad of [
    { ...entry, target: { kind: "customer", id: "one" } },
    { id: entry.id, occurredAt: entry.occurredAt, actor, action: entry.action, target: entry.target, after: entry.after },
    { id: entry.id, occurredAt: entry.occurredAt, actor, action: entry.action, target: entry.target, before: entry.before },
  ]) expect(parseAuditListResponse({ version: 1, entries: [bad], nextCursor: null })).toBeNull();
});
