import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createCardEventStore } from "./store";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `card_events_contract_test_${randomBytes(4).toString("hex")}`;
let admin: Bun.SQL, sql: SqlExecutor;
const run = connectionString ? describe : describe.skip;

run("card event PostgreSQL store", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(await readMigrationSql("015_cards.sql"));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });
  test("atomically dedupes by mode and message ID and prunes expired unknown-owner rows", async () => {
    const store = createCardEventStore(sql);
    const event = { mode: "sandbox" as const, messageId: "same", topic: "payment-updated", cardholderAccountId: null, cardId: null, paymentId: null };
    expect(await store.insert(event)).toBe(true);
    expect(await store.insert(event)).toBe(false);
    expect(await store.insert({ ...event, mode: "production" })).toBe(true);
    await sql.query("UPDATE card_events SET received_at = now() - interval '31 days' WHERE mode = 'sandbox'");
    expect(await store.insert({ ...event, messageId: "next" })).toBe(true);
    const remaining = await sql.query<{ mode: string; message_id: string }>("SELECT mode, message_id FROM card_events ORDER BY mode, message_id");
    expect(remaining.rows).toEqual([
      { mode: "production", message_id: "same" },
      { mode: "sandbox", message_id: "next" },
    ]);
  });
});
