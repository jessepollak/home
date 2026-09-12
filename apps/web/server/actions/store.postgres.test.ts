import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { SqlExecutor } from "@/server/db/sql";
import { ActionsStore, actionOwnerKey } from "./store";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
let client: BunSqlClient;
let store: ActionsStore;
const owner = { subject: "action-pg", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const otherOwner = { ...owner, subject: "action-pg-other" };
const summary = { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" };
const calls = [{ to: owner.address, data: "0x1234" as const, value: "0" }];

describePostgres("actions schema and store", () => {
  beforeAll(async () => {
    client = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    store = new ActionsStore(bunExecutor(client));
  });
  beforeEach(async () => { await client.unsafe("TRUNCATE actions"); });
  afterAll(async () => {
    await client?.unsafe("TRUNCATE actions");
    await client?.close();
  });

  test("uses the migrate-first actions schema with migration tracking", async () => {
    const tables = Array.from(await client.unsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('actions','schema_migrations') ORDER BY table_name")) as Array<{ table_name: string }>;
    expect(tables.map(({ table_name }) => table_name)).toEqual(["actions", "schema_migrations"]);
    const columns = Array.from(await client.unsafe("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'actions' ORDER BY ordinal_position")) as Array<{ column_name: string }>;
    expect(columns.map(({ column_name }) => column_name)).toEqual([
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

  test("lazy GC deletes stale drafts and lists only recent confirmed owner rows", async () => {
    const stale = randomUUID();
    const recent = randomUUID();
    await store.insert({ id: stale, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T00:00:00.000Z" });
    await store.insert({ id: recent, owner, kind: "send", summary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, recent);
    const rows = await store.list(owner);
    expect(rows.map(({ id }) => id)).toEqual([recent]);
    const staleRows = Array.from(await client.unsafe("SELECT id FROM actions WHERE owner_key = $1 AND id = $2", [actionOwnerKey(owner), stale]));
    expect(staleRows).toHaveLength(0);
  });
});

function bunExecutor(sqlClient: BunSqlClient, inTransaction = false): SqlExecutor {
  return {
    async query<T>(text: string, values: unknown[] = []) {
      const rows = Array.from(await sqlClient.unsafe(text, values)) as T[];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>) {
      if (inTransaction) throw new Error("nested transaction unsupported");
      return sqlClient.begin((transaction) => run(bunExecutor(transaction, true)));
    },
  };
}
