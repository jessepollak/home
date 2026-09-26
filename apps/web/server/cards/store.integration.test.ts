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
      await tx.unsafe(await readMigrationSql("009_cards.sql"));
      await tx.unsafe("INSERT INTO card_events (mode, message_id, topic) VALUES ('sandbox', 'legacy', 'payment-updated')");
      await tx.unsafe(await readMigrationSql("011_card_events_provider.sql"));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });
  test("migrates legacy rows, scopes dedupe by provider and mode, and prunes old rows", async () => {
    const store = createCardEventStore(sql);
    const event = { provider: "immersve" as const, mode: "sandbox" as const, eventId: "same", kind: "payment-updated", occurredAt: new Date().toISOString(), externalIds: { cardholder: null, card: null, transaction: null, customer: null } };
    expect(await store.insert(event)).toBe(true);
    expect(await store.insert(event)).toBe(false);
    expect(await store.insert({ ...event, mode: "production" })).toBe(true);
    expect(await store.insert({ ...event, provider: "bridge" })).toBe(true);
    const legacy = await sql.query<{ provider: string; event_id: string; kind: string; occurred_at: Date }>("SELECT provider, event_id, kind, occurred_at FROM card_events WHERE event_id = 'legacy'");
    expect(legacy.rows[0]?.provider).toBe("immersve");
    expect(legacy.rows[0]?.kind).toBe("payment-updated");
    expect(legacy.rows[0]?.occurred_at).toBeTruthy();
    const stored = await sql.query<{ kind: string }>("SELECT kind FROM card_events WHERE provider = 'bridge' AND mode = 'sandbox' AND event_id = 'same'");
    expect(stored.rows).toEqual([{ kind: "payment-updated" }]);
    await sql.query("UPDATE card_events SET received_at = now() - interval '31 days' WHERE provider = 'immersve' AND mode = 'sandbox'");
    expect(await store.insert({ ...event, eventId: "next" })).toBe(true);
    const remaining = await sql.query<{ provider: string; mode: string; event_id: string }>("SELECT provider, mode, event_id FROM card_events ORDER BY provider, mode, event_id");
    expect(remaining.rows).toEqual([
      { provider: "bridge", mode: "sandbox", event_id: "same" },
      { provider: "immersve", mode: "production", event_id: "same" },
      { provider: "immersve", mode: "sandbox", event_id: "next" },
    ]);
  });
});
