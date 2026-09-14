import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { ActionsStore, actionOwnerKey } from "./store";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const TEST_SCHEMA = "actions_contract_test";
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: BunSqlClient;
let sql: SqlExecutor;
let store: ActionsStore;
const owner = { subject: "action-pg", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const baseOwner = { ...owner, subject: "action-pg-base", accountProvider: "base-account" as const };
const otherOwner = { ...owner, subject: "action-pg-other" };
const summary = { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" };
const calls = [{ to: owner.address, data: "0x1234" as const, value: "0" }];

describePostgres("actions schema and store", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const migration = await readFile(resolve(import.meta.dir, "../db/migrations/001_actions.sql"), "utf8");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${TEST_SCHEMA}`);
      await transaction.unsafe(`CREATE TABLE schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await transaction.unsafe(migration);
      await transaction.unsafe(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        ["db/001_actions.sql"],
      );
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema: TEST_SCHEMA });
    store = new ActionsStore(sql);
  });
  beforeEach(async () => { await sql.query("TRUNCATE actions"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin?.close();
  });

  test("uses the migrate-first actions schema with migration tracking", async () => {
    const tables = await sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('actions','schema_migrations') ORDER BY table_name",
      [TEST_SCHEMA],
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(["actions", "schema_migrations"]);
    const columns = await sql.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'actions' ORDER BY ordinal_position",
      [TEST_SCHEMA],
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "id", "owner_key", "provider", "kind", "summary", "pending", "created_at",
      "confirmed_at", "provider_handle", "transaction_hash", "handle_recorded_at",
    ]);
  });

  test("scopes reads, clears pending on confirm, and records immutable handles", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    expect(await store.get(otherOwner, id)).toBeNull();
    const confirmed = await store.confirm(owner, id);
    expect(confirmed?.pending?.calls).toEqual(calls);
    expect((await store.get(owner, id))?.pending).toBeNull();
    expect((await store.get(owner, id))?.confirmed_at).not.toBeNull();
    expect((await store.recordHandle(owner, id, { providerHandle: `0x${"ab".repeat(32)}` }))?.provider_handle).toBe(`0x${"ab".repeat(32)}`);
    expect(await store.recordHandle(owner, id, { providerHandle: `0x${"cd".repeat(32)}` })).toBeNull();
  });

  test("base-account confirmation leaves the provider handle empty until the wallet handle is recorded", async () => {
    const id = randomUUID();
    const walletHandle = `0x${"ef".repeat(32)}`;
    await store.insert({ id, owner: baseOwner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });

    expect((await store.confirm(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.get(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.recordHandle(baseOwner, id, { providerHandle: walletHandle }))?.provider_handle).toBe(walletHandle);
  });

  test("lazy GC deletes stale drafts and lists only recent confirmed owner rows", async () => {
    const stale = randomUUID();
    const recent = randomUUID();
    await store.insert({ id: stale, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T00:00:00.000Z" });
    await store.insert({ id: recent, owner, kind: "send", summary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, recent);
    const rows = await store.list(owner);
    expect(rows.map(({ id }) => id)).toEqual([recent]);
    const staleRows = await sql.query(
      "SELECT id FROM actions WHERE owner_key = $1 AND id = $2",
      [actionOwnerKey(owner), stale],
    );
    expect(staleRows.rows).toHaveLength(0);
  });
});
