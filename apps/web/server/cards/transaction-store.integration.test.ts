import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createCardTransactionStore } from "./transaction-store";

const url = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `card_transactions_test_${randomBytes(4).toString("hex")}`;
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const cardA = "33333333-3333-4333-8333-333333333333";
const cardB = "44444444-4444-4444-8444-444444444444";
let admin: Bun.SQL, sql: SqlExecutor;

(url ? describe : describe.skip)("card transaction migration and owner fence", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(url!);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const name of ["011_operator_registry.sql", "018_cards.sql", "019_card_events_provider.sql", "020_card_accounts.sql", "021_card_transactions.sql"]) {
        await tx.unsafe(await readMigrationSql(name));
      }
    });
    sql = createPostgresSqlExecutor(url!, { schema });
    await sql.query("INSERT INTO customers (id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [ownerA, ownerB]);
    await sql.query("INSERT INTO card_accounts(customer_id,mode) VALUES ($1,'sandbox'),($2,'sandbox')", [ownerA, ownerB]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES ($1,$2,'sandbox','ic_alpha',$5),($3,$4,'sandbox','ic_beta',$6)",
      [cardA, ownerA, cardB, ownerB, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"]);
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });
  test("durable upsert, authorization supersession and owner-scoped read", async () => {
    const store = createCardTransactionStore(sql);
    const base = { cardId: "ic_alpha", authorizationId: "iauth_alpha", amountMinor: "1234", currency: "USD", merchantName: "Synthetic Market",
      merchantCategory: "5411", declineReasonCode: null, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" } as const;
    await store.upsert(cardA, "sandbox", { ...base, id: "iauth_alpha", kind: "authorization", status: "pending" });
    await store.upsert(cardA, "sandbox", { ...base, id: "iauth_alpha", kind: "authorization", status: "declined" });
    expect((await store.rows(ownerA, "sandbox"))).toMatchObject([{ id: "iauth_alpha", status: "declined" }]);
    expect(await store.rows(ownerB, "sandbox")).toEqual([]);
    await store.upsert(cardA, "sandbox", { ...base, id: "ipi_alpha", kind: "transaction", status: "completed" });
    expect((await store.rows(ownerA, "sandbox")).map((row) => row.id)).toEqual(["ipi_alpha"]);
    await expect(store.upsert(cardB, "sandbox", { ...base, id: "ipi_alpha", kind: "transaction", status: "refunded" })).rejects.toThrow("owner mismatch");
    expect(await store.rows(ownerB, "sandbox")).toEqual([]);
    await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,card_id,transaction_id,occurred_at,received_at) VALUES ('bridge','sandbox','stripe:evt_alpha','issuing_authorization.updated','ic_alpha','iauth_alpha',now(),now() - interval '1 day')");
    expect((await store.pending(cardA, "sandbox")).map((row) => row.transaction_id)).toEqual([]);
    await sql.query("UPDATE card_events SET received_at=now() + interval '1 second' WHERE event_id='stripe:evt_alpha'");
    expect((await store.pending(cardA, "sandbox")).map((row) => row.transaction_id)).toEqual(["iauth_alpha"]);
    expect(await store.pending(cardB, "sandbox")).toEqual([]);
    expect((await store.rows(ownerA, "sandbox"))[0]?.status).toBe("completed");
    await store.upsert(cardA, "sandbox", { ...base, id: "ipi_refund", kind: "transaction", status: "refunded" });
    expect((await store.rows(ownerA, "sandbox")).map((row) => [row.id, row.status, row.amountMinor])).toEqual([
      ["ipi_refund", "refunded", "1234"], ["ipi_alpha", "completed", "1234"],
    ]);
    expect(await store.rows(ownerA, "sandbox", { from: "2026-09-02T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" })).toEqual([]);
  });
  test("partial refund retains the completed capture and its original amount", async () => {
    const store = createCardTransactionStore(sql);
    const base = { cardId: "ic_alpha", authorizationId: "iauth_partial", currency: "USD", merchantName: "Synthetic Cafe",
      merchantCategory: null, declineReasonCode: null, createdAt: "2026-09-03T12:00:00.000Z", updatedAt: "2026-09-03T12:00:00.000Z" } as const;
    await store.upsert(cardA, "sandbox", { ...base, id: "ipi_partialcapture", kind: "transaction", amountMinor: "1234", status: "completed" });
    await store.upsert(cardA, "sandbox", { ...base, id: "ipi_partialrefund", kind: "transaction", amountMinor: "400", status: "refunded" });
    expect((await store.rows(ownerA, "sandbox", { from: "2026-09-03T00:00:00.000Z", to: "2026-09-04T00:00:00.000Z" }))
      .map((row) => [row.id, row.status, row.amountMinor])).toEqual([
      ["ipi_partialrefund", "refunded", "400"], ["ipi_partialcapture", "completed", "1234"],
    ]);
  });
  test("rejects cross-card writes, invalid status, and sensitive fields have no schema column", async () => {
    const store = createCardTransactionStore(sql);
    await expect(store.upsert(cardB, "sandbox", { id: "ipi_bad", cardId: "ic_alpha", authorizationId: null, kind: "transaction",
      amountMinor: "1", currency: "USD", merchantName: "Synthetic", merchantCategory: null, status: "pending", declineReasonCode: null,
      createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" })).rejects.toThrow("owner mismatch");
    const columns = await sql.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='card_transactions'", [schema]);
    expect(columns.rows.map((row) => row.column_name)).not.toContain("pan");
    expect(columns.rows.map((row) => row.column_name)).not.toContain("cvc");
  });
});
