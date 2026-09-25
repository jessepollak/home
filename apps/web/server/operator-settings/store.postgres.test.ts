import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { AdminAuditLog } from "./audit";
import { createSettingsDomainHandlers } from "./handlers";
import { OperatorSettingsConflictError, OperatorSettingsCorruptError, OperatorSettingsStore, OperatorSettingsValidationError } from "./store";

const connectionString = process.env.OPERATOR_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "operator_809_contract_test";
const actor = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const value = { email: "help@example.com", url: "https://example.com/support" };
type AdminSql = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(fn: (tx: AdminSql) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: AdminSql;
let sql: SqlExecutor;
let store: OperatorSettingsStore;
let audit: AdminAuditLog;
let migration: string;
const session = (address: typeof actor | typeof other): VerifiedAccountSession => ({ user: { subject: "operator" }, smartAccount: { address, chainId: BASE_CHAIN_ID }, accountProvider: "base-account" });

describePostgres("operator settings and audit against PostgreSQL", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as AdminSql;
    migration = await readMigrationSql("010_operator_settings.sql");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new OperatorSettingsStore(sql);
    audit = new AdminAuditLog(sql);
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("defaults, writes, restart reads, revisions, no-ops, and audited before/after", async () => {
    expect(await store.read("support")).toEqual({ domain: "support", settings: { value: { email: null, url: null }, revision: 0, source: "default", updatedAt: null, updatedBy: null } });
    expect(await store.readAll()).toHaveLength(1);
    await expect(store.write({ domain: "support", expectedRevision: 0, value: { email: "bad", url: null }, actor })).rejects.toBeInstanceOf(OperatorSettingsValidationError);
    expect((await audit.list()).entries).toHaveLength(0);
    const first = await store.write({ domain: "support", expectedRevision: 0, value, actor });
    expect(first.settings).toMatchObject({ value, revision: 1, source: "stored", updatedBy: actor });
    expect(first.settings.updatedAt).toEqual(expect.any(String));
    const freshSql = createPostgresSqlExecutor(connectionString!, { schema });
    try { expect((await new OperatorSettingsStore(freshSql).read("support")).settings.value).toEqual(value); }
    finally { await freshSql.dispose?.(); }
    await expect(store.write({ domain: "support", expectedRevision: 0, value, actor })).rejects.toBeInstanceOf(OperatorSettingsConflictError);
    expect((await store.write({ domain: "support", expectedRevision: 1, value, actor })).settings.revision).toBe(1);
    const next = { email: null, url: "https://example.com" };
    expect((await store.write({ domain: "support", expectedRevision: 1, value: next, actor })).settings.revision).toBe(2);
    const entries = (await audit.list()).entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.action)).toEqual(["settings.update", "settings.update"]);
    expect(entries[0]).toMatchObject({ actor, action: "settings.update", target: { kind: "settings", id: "support" }, before: value, after: next });
    expect(entries[1]).toMatchObject({ actor, action: "settings.update", target: { kind: "settings", id: "support" }, before: { email: null, url: null }, after: value });
  });

  test("customer reads validate purpose, paginate in descending id order, and reject mutation", async () => {
    for (const purpose of ["", " trailing ", "x".repeat(201)]) await expect(audit.recordCustomerRead({ actor, customerId: "customer-1", purpose })).rejects.toBeInstanceOf(OperatorSettingsValidationError);
    await expect(audit.recordCustomerRead({ actor, customerId: "", purpose: "support" })).rejects.toBeInstanceOf(OperatorSettingsValidationError);
    await audit.recordCustomerRead({ actor, customerId: "customer-1", purpose: "support request" });
    const first = await audit.list({ limit: 1 });
    expect(first.entries[0]).toMatchObject({ action: "customer.read", actor, target: { kind: "customer", id: "customer-1" }, purpose: "support request" });
    expect(first.nextCursor).toBe(first.entries[0]!.id);
    const second = await audit.list({ limit: 2, before: first.nextCursor! });
    expect(second.entries.map((entry) => entry.action)).toEqual(["settings.update", "settings.update"]);
    expect(second.nextCursor).toBeNull();
    await expect(sql.query("UPDATE admin_audit_log SET purpose = 'changed' WHERE id = $1", [first.entries[0]!.id])).rejects.toThrow();
    await expect(sql.query("DELETE FROM admin_audit_log WHERE id = $1", [first.entries[0]!.id])).rejects.toThrow();
    await expect(sql.query("TRUNCATE admin_audit_log")).rejects.toThrow();
    expect((await audit.list()).entries).toHaveLength(3);
  });

  test("migration replay preserves rows and audit entries", async () => {
    await admin.begin(async (tx) => { await tx.unsafe(`SET LOCAL search_path TO ${schema}`); await tx.unsafe(migration); });
    expect((await store.read("support")).settings.revision).toBe(2);
    expect((await audit.list()).entries).toHaveLength(3);
  });

  test("upgrade old stored values in memory without rewriting and reject newer/corrupt versions", async () => {
    const upgraded = new OperatorSettingsStore(sql, {
      support: { schemaVersion: 2, defaults: { email: null as string | null, url: null as string | null, phone: null as string | null },
        parse: (input: unknown) => {
          if (!input || typeof input !== "object" || !("phone" in input) || !("email" in input) || !("url" in input)) return null;
          return input as { email: string | null; url: string | null; phone: string | null };
        },
        upgrade: (version: number, input: unknown) => version === 1 ? { ...(input as object), phone: null } : input,
      },
    });
    expect((await upgraded.read("support")).settings.value).toEqual({ email: null, url: "https://example.com", phone: null });
    expect((await store.read("support")).settings.value).toEqual({ email: null, url: "https://example.com" });
    await sql.query("UPDATE operator_settings SET schema_version = 3 WHERE domain = 'support'");
    await expect(store.read("support")).rejects.toBeInstanceOf(OperatorSettingsCorruptError);
    await sql.query("UPDATE operator_settings SET schema_version = 1, value = $1::jsonb WHERE domain = 'support'", [JSON.stringify({ email: "bad", url: null })]);
    await expect(store.read("support")).rejects.toBeInstanceOf(OperatorSettingsCorruptError);
    await sql.query("UPDATE operator_settings SET value = $1::jsonb WHERE domain = 'support'", [JSON.stringify(value)]);
  });

  test("real handler allows admin writes but rejects non-admin before any read or write", async () => {
    const handler = (address: typeof actor | typeof other) => createSettingsDomainHandlers({
      authorize: async () => session(address), config: () => ({ kind: "configured", addresses: new Set([actor]) }),
      store: () => store,
    }).PUT;
    const makeRequest = () => new Request("https://home.test/api/admin/settings/support", { method: "PUT", headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify({ version: 1, expectedRevision: 2, value: { email: null, url: null } }) });
    const context = { params: Promise.resolve({ domain: "support" }) };
    const count = (await audit.list()).entries.length;
    expect((await handler(other)(makeRequest(), context)).status).toBe(403);
    expect((await audit.list()).entries).toHaveLength(count);
    expect((await store.read("support")).settings.revision).toBe(2);
    const result = await handler(actor)(makeRequest(), context);
    expect(result.status).toBe(200);
    expect((await result.json()).settings.revision).toBe(3);
    expect((await audit.list()).entries).toHaveLength(count + 1);
  });

  test("concurrent first inserts admit one winner and record only one change", async () => {
    await sql.query("DELETE FROM operator_settings WHERE domain = 'support'");
    const before = (await audit.list()).entries.length;
    const results = await Promise.allSettled([
      store.write({ domain: "support", expectedRevision: 0, value, actor }),
      store.write({ domain: "support", expectedRevision: 0, value: { email: null, url: "https://example.com" }, actor }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await store.read("support")).settings.revision).toBe(1);
    expect((await audit.list()).entries).toHaveLength(before + 1);
  });
});
