import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { keccak256 } from "viem";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
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
    const migration = await readMigrationSql("001_actions.sql");
    const outcomesMigration = await readMigrationSql("012_action_outcomes.sql");
    const callCommitmentMigration = await readMigrationSql("013_action_call_commitment.sql");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${TEST_SCHEMA}`);
      await transaction.unsafe(`CREATE TABLE schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await transaction.unsafe(migration);
      await transaction.unsafe(outcomesMigration);
      await transaction.unsafe(callCommitmentMigration);
      await transaction.unsafe(
        "INSERT INTO schema_migrations (name) VALUES ($1), ($2)",
        ["db/001_actions.sql", "db/013_action_call_commitment.sql"],
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
      "account_address", "declined_reported_at", "dispatch_attempt", "outcome", "outcome_source", "settled_at", "outcome_recorded_at", "confirmed_call_data_hash",
    ]);
  });

  test("scopes reads, clears pending on confirm, and records immutable handles", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    expect(await store.get(otherOwner, id)).toBeNull();
    const confirmed = await store.confirm(owner, id);
    expect(confirmed?.pending?.calls).toEqual(calls);
    expect(confirmed?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(calls)));
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(calls)));
    expect((await store.get(owner, id))?.pending).toBeNull();
    expect((await store.get(owner, id))?.confirmed_at).not.toBeNull();
    expect((await store.recordHandle(owner, id, { providerHandle: `0x${"ab".repeat(32)}` }))?.provider_handle).toBe(`0x${"ab".repeat(32)}`);
    expect(await store.recordHandle(owner, id, { providerHandle: `0x${"cd".repeat(32)}` })).toBeNull();
  });

  test("confirmation commits finalized calls rather than the pending draft", async () => {
    const id = randomUUID();
    const finalCalls = [{ ...calls[0]!, data: "0x5678" as const }];
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBeNull();
    expect((await store.confirm(owner, id, finalCalls))?.pending?.calls).toEqual(finalCalls);
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(finalCalls)));
  });

  test("trade confirmation keeps only the committed plan until a handle or outcome exists", async () => {
    const finalCalls = [{ ...calls[0]!, data: "0x5678" as const }];
    const handled = randomUUID();
    const settled = randomUUID();
    for (const id of [handled, settled]) {
      await store.insert({ id, owner, kind: "trade", summary, pending: { calls, swapCallIndex: 0 }, createdAt: "2026-09-12T10:00:00.000Z" });
      await store.confirm(owner, id, finalCalls);
      expect((await store.get(owner, id))?.pending).toEqual({ calls: finalCalls });
    }
    await store.recordHandle(owner, handled, { providerHandle: `0x${"ab".repeat(32)}` });
    expect((await store.get(owner, handled))?.pending).toBeNull();
    await store.recordOutcome(owner, settled, { outcome: "not_submitted", source: "wallet", settledAt: null });
    expect((await store.get(owner, settled))?.pending).toBeNull();
  });

  test("confirmation without pending calls does not write a commitment", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    await sql.query("UPDATE actions SET pending = NULL WHERE id = $1", [id]);
    expect((await store.confirm(owner, id))?.confirmed_call_data_hash).toBeNull();
  });

  test("base-account confirmation leaves the provider handle empty until the wallet handle is recorded", async () => {
    const id = randomUUID();
    const walletHandle = `0x${"ef".repeat(32)}`;
    await store.insert({ id, owner: baseOwner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });

    expect((await store.confirm(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.get(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.recordHandle(baseOwner, id, { providerHandle: walletHandle }))?.provider_handle).toBe(walletHandle);
  });

  test("lists bounded dispatched sends across history with owner isolation", async () => {
    const older = randomUUID();
    const newer = randomUUID();
    const reviewedOnly = randomUUID();
    const other = randomUUID();
    for (const [id, actionOwner] of [[older, owner], [newer, owner], [reviewedOnly, owner], [other, otherOwner]] as const) {
      await store.insert({ id, owner: actionOwner, kind: "send", summary, pending: { calls }, createdAt: "2020-01-01T00:00:00.000Z" });
      await store.confirm(actionOwner, id);
    }
    await store.recordHandle(owner, older, { providerHandle: `0x${"11".repeat(32)}` });
    await store.recordHandle(owner, newer, { transactionHash: `0x${"22".repeat(32)}` });
    await store.recordHandle(otherOwner, other, { providerHandle: `0x${"33".repeat(32)}` });
    await sql.query("UPDATE actions SET confirmed_at = CASE id WHEN $1 THEN $3::timestamptz WHEN $2 THEN $4::timestamptz ELSE $5::timestamptz END", [
      older,
      newer,
      "2020-01-01T00:00:00.000Z",
      "2020-02-01T00:00:00.000Z",
      "2020-03-01T00:00:00.000Z",
    ]);

    expect((await store.listDispatchedSends(owner, 1)).map(({ id }) => id)).toEqual([newer]);
    expect((await store.listDispatchedSends(owner, 10)).map(({ id }) => id)).toEqual([newer, older]);
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
