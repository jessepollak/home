import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createCardAccountStore } from "./account-store";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `card_accounts_test_${randomBytes(4).toString("hex")}`;
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
let admin: Bun.SQL, sql: SqlExecutor;

(connectionString ? describe : describe.skip)("card accounts PostgreSQL schema and owner-scoped store", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      await tx.unsafe(await readMigrationSql("011_operator_registry.sql"));
      await tx.unsafe(await readMigrationSql("020_card_accounts.sql"));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    await sql.query("INSERT INTO customers (id, first_seen_at, last_seen_at, first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [ownerA, ownerB]);
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });
  test("multiple cards per account, separate modes, replacement on the same wallet, no cross-owner read", async () => {
    await sql.query("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox','bridge-A','ich_A'),($1,'production','bridge-B','ich_B'),($2,'sandbox','bridge-C','ich_C')", [ownerA, ownerB]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES ($1,$2,'sandbox','ic_A',$4),($3,$2,'sandbox','ic_B',$5)", ["33333333-3333-4333-8333-333333333333", ownerA, "44444444-4444-4444-8444-444444444444", "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"]);
    const store = createCardAccountStore(sql);
    expect((await store.read(ownerA, "sandbox"))?.cards.map((card) => card.stripeCardId)).toEqual(["ic_A", "ic_B"]);
    expect((await store.read(ownerB, "sandbox"))?.cards).toEqual([]);
    expect((await store.read(ownerA, "production"))?.bridgeCustomerId).toBe("bridge-B");
    await sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','ic_C',$2)", [ownerA, "0x1111111111111111111111111111111111111111"]);
    expect((await store.read(ownerA, "sandbox"))?.cards.map((card) => card.stripeCardId)).toEqual(["ic_A", "ic_B", "ic_C"]);
    await expect(sql.query("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','ic_A',$2)", [ownerA, "0x1111111111111111111111111111111111111111"])).rejects.toThrow();
    await expect(sql.query("INSERT INTO card_accounts(customer_id,mode) VALUES ($1,'sandbox')", [ownerA])).rejects.toThrow();
  });
});
