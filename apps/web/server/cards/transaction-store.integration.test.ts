import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createCardTransactionStore } from "./transaction-store";
const url = process.env.FUNDING_PG_TEST_URL?.trim(); const schema = `card_transactions_${randomBytes(4).toString("hex")}`;
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const card = "33333333-3333-4333-8333-333333333333", otherCard = "44444444-4444-4444-8444-444444444444";
let admin: Bun.SQL, sql: SqlExecutor;
const base = { cardId: "provider-card", authorizationId: "auth-fixture", amountMinor: "1234", currency: "USD", merchantName: "Synthetic Market", merchantCategory: null,
  declineReasonCode: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } as const;
(url ? describe : describe.skip)("card program purchases integrity", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(url!); await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const name of ["011_operator_registry.sql", "018_cards.sql", "019_card_events_provider.sql", "020_card_accounts.sql", "021_card_transactions.sql", "022_card_programs.sql"])
        await tx.unsafe(await readMigrationSql(name));
    }); sql = createPostgresSqlExecutor(url!, { schema });
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [owner, other]);
    await sql.query("INSERT INTO card_accounts(customer_id,mode,provider) VALUES ($1,'sandbox','bridge'),($2,'sandbox','immersve')", [owner, other]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES ($1,$2,'sandbox','bridge','provider-card',$5),($3,$4,'sandbox','immersve','provider-card',$5)", [card, owner, otherCard, other, "0x1111111111111111111111111111111111111111"]);
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });
  test("upsert and supersession are scoped by provider, mode and owner", async () => {
    const store = createCardTransactionStore(sql);
    await store.upsert(card, "sandbox", "bridge", { ...base, id: "auth-fixture", kind: "authorization", status: "pending" });
    await store.upsert(card, "sandbox", "bridge", { ...base, id: "auth-fixture", kind: "authorization", status: "declined" });
    expect((await store.rows(owner, "sandbox"))[0]?.status).toBe("declined"); expect(await store.rows(other, "sandbox")).toEqual([]);
    await store.upsert(card, "sandbox", "bridge", { ...base, id: "capture-fixture", kind: "transaction", status: "completed" });
    expect((await store.rows(owner, "sandbox")).map((row) => row.kind)).toEqual(["transaction"]);
    expect((await store.rows(owner, "sandbox"))[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(store.upsert(otherCard, "sandbox", "bridge", { ...base, id: "capture-fixture", kind: "transaction", status: "refunded" })).rejects.toThrow("owner mismatch");
    await store.upsert(otherCard, "sandbox", "immersve", { ...base, id: "capture-fixture", kind: "transaction", status: "refunded" });
    expect((await store.rows(other, "sandbox"))[0]?.status).toBe("refunded");
    expect(await store.rows(owner, "sandbox", { from: "2026-10-02T00:00:00Z", to: "2026-11-01T00:00:00Z" })).toEqual([]);
  });
  test("provider-neutral webhook join cannot refresh another program's card", async () => {
    const store = createCardTransactionStore(sql);
    await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,card_id,transaction_id,occurred_at) VALUES ('immersve','sandbox','event-other','purchase','provider-card','other-purchase',now())");
    expect(await store.pending(card, "sandbox")).toEqual([]);
    expect((await store.pending(otherCard, "sandbox"))[0]?.externalIds.transaction).toBe("other-purchase");
  });
  test("oldest pending events drain within the targeted refresh budget", async () => {
    const store = createCardTransactionStore(sql);
    for (let i = 0; i < 12; i++) await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,card_id,transaction_id,occurred_at,received_at) VALUES ('bridge','sandbox',$1,'purchase','provider-card',$2,now(),now() - interval '1 hour' + $3 * interval '1 second')", [`event${i}`, `auth${i}`, i]);
    expect((await store.pending(card, "sandbox")).map((event) => event.externalIds.transaction)).toEqual(Array.from({ length: 11 }, (_, i) => `auth${i}`));
    for (let i = 0; i < 10; i++) await store.upsert(card, "sandbox", "bridge", { ...base, id: `auth${i}`, authorizationId: `auth${i}`, kind: "authorization", status: "pending" });
    expect((await store.pending(card, "sandbox")).map((event) => event.externalIds.transaction)).toEqual(["auth10", "auth11"]);
  });
  test("representative pending-event plans use the selective provider-card index", async () => {
    await sql.query("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) SELECT md5('customer'||g)::uuid,now(),now(),'sign_in' FROM generate_series(1,10000) g");
    await sql.query("INSERT INTO card_accounts(customer_id,mode,provider) SELECT md5('customer'||g)::uuid,'sandbox','bridge' FROM generate_series(1,10000) g");
    await sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) SELECT md5('card'||g)::uuid,md5('customer'||g)::uuid,'sandbox','bridge','bulk-card'||g,'0x'||lpad(to_hex(g),40,'0') FROM generate_series(1,10000) g");
    await sql.query("INSERT INTO card_events(provider,mode,event_id,kind,card_id,transaction_id,occurred_at) SELECT 'bridge','sandbox','bulk-event'||g,'purchase','bulk-card'||(1+(g%10000)),'bulk-purchase'||g,now() FROM generate_series(1,50000) g");
    await sql.query("ANALYZE cards"); await sql.query("ANALYZE card_events"); await sql.query("ANALYZE card_transactions");
    type Node = { "Index Name"?: string; "Node Type": string; "Actual Rows"?: number; Plans?: Node[] };
    const nodes = (node: Node): Node[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
    for (const target of [card, "11111111-1111-4111-8111-111111111111"]) {
      let captured: Node[] = [];
      const measured = createCardTransactionStore({ query: async <T>(text: string, values?: unknown[]) => {
        const explained = await sql.query<{ "QUERY PLAN": { Plan: Node; "Execution Time": number }[] }>(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${text}`, values);
        const plan = explained.rows[0]?.["QUERY PLAN"][0];
        if (!plan) throw new Error("Missing query plan");
        captured = nodes(plan.Plan);
        console.info("Card pending plan", { case: target === card ? "linked" : "empty", indexes: captured.flatMap((node) => node["Index Name"] ? [node["Index Name"]] : []), elapsedMs: plan["Execution Time"] });
        return sql.query<T>(text, values);
      } });
      await measured.pending(target, "sandbox");
      expect(captured.some((node) => node["Index Name"] === "cards_pkey")).toBe(true);
      expect(captured.some((node) => node["Index Name"] === "card_events_provider_card_idx")).toBe(true);
      expect(captured.filter((node) => node["Index Name"] === "card_events_provider_card_idx").every((node) => (node["Actual Rows"] ?? 0) <= 12)).toBe(true);
    }
  });
  test("partial refund retains capture amount and voided transaction supersedes authorization", async () => {
    const store = createCardTransactionStore(sql);
    const row = { ...base, authorizationId: "auth-partial", createdAt: "2026-10-03T00:00:00.000Z" };
    await store.upsert(card, "sandbox", "bridge", { ...row, id: "partial-capture", kind: "transaction", status: "completed" });
    await store.upsert(card, "sandbox", "bridge", { ...row, id: "partial-refund", kind: "transaction", amountMinor: "400", status: "refunded" });
    expect((await store.rows(owner, "sandbox", { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" })).map((row) => [row.status, row.amountMinor])).toEqual([["refunded", "400"], ["completed", "1234"]]);
    const voided = { ...base, authorizationId: "auth-void", createdAt: "2026-10-04T00:00:00.000Z" };
    await store.upsert(card, "sandbox", "bridge", { ...voided, id: "auth-void", kind: "authorization", status: "pending" });
    await store.upsert(card, "sandbox", "bridge", { ...voided, id: "capture-void", kind: "transaction", status: "reversed" });
    expect((await store.rows(owner, "sandbox", { from: "2026-10-04T00:00:00Z", to: "2026-10-05T00:00:00Z" })).map((row) => row.status)).toEqual(["reversed"]);
  });
});
