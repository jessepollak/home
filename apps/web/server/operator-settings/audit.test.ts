import { expect, test } from "bun:test";
import type { SqlExecutor } from "@/server/db/sql";
import { parseAuditListResponse } from "@/shared/operator-settings/contract";
import { AdminAuditLog } from "./audit";

const actor = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function row(action: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "7", occurred_at: new Date("2026-09-25T12:00:00.000Z"), actor, action,
    target_kind: "settings", target_id: "support-assistant-key", purpose: null,
    before: { last4: null }, after: { last4: "abcd" }, ...overrides,
  };
}

function log(rows: unknown[]): AdminAuditLog {
  const sql = { query: async () => ({ rows, rowCount: rows.length }) } as unknown as SqlExecutor;
  return new AdminAuditLog(sql);
}

test("credential audit rows present as their own actions and stay parseable", async () => {
  const entries = (await log([
    row("support.credential.update"),
    row("support.credential.delete", { before: { last4: "abcd" }, after: { last4: null } }),
  ]).list()).entries;
  expect(entries.map((entry) => entry.action)).toEqual(["support.credential.update", "support.credential.delete"]);
  expect(entries.map((entry) => entry.target)).toEqual([
    { kind: "settings", id: "support-assistant-key" },
    { kind: "settings", id: "support-assistant-key" },
  ]);
  expect(parseAuditListResponse({ version: 1, entries, nextCursor: null })).not.toBeNull();
});

test("a malformed stored row fails loudly instead of presenting as a customer read", async () => {
  await expect(log([row("customer.read", { target_kind: "customer", target_id: "customer-1", purpose: null })]).list()).rejects.toThrow("Stored customer read audit row is malformed");
  await expect(log([row("customer.read", { target_kind: "settings", target_id: "support-assistant-key" })]).list()).rejects.toThrow("Stored customer read audit row is malformed");
  await expect(log([row("settings.update", { target_kind: "customer", target_id: "customer-1" })]).list()).rejects.toThrow("Stored settings audit row is malformed");
  await expect(log([row("support.unknown.action")]).list()).rejects.toThrow("Stored audit action is not recognised");
});
