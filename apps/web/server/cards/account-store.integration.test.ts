import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { createCardAccountStore } from "./account-store";
const url = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `card_accounts_${randomBytes(4).toString("hex")}`;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const wallet = "0x1111111111111111111111111111111111111111";
let admin: Bun.SQL, sql: SqlExecutor;
(url ? describe : describe.skip)("card program migration and account integrity", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(url!); await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const name of ["011_operator_registry.sql", "018_cards.sql", "019_card_events_provider.sql", "020_card_accounts.sql", "021_card_transactions.sql"])
        await tx.unsafe(await readMigrationSql(name));
      await tx.unsafe("INSERT INTO customers(id,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,now(),now(),'sign_in'),($2,now(),now(),'sign_in')", [owner, other]);
      await tx.unsafe("INSERT INTO card_accounts(customer_id,mode,bridge_customer_id,stripe_cardholder_id) VALUES ($1,'sandbox','bridge-A','ich_A')", [owner]);
      await tx.unsafe("INSERT INTO cards(id,customer_id,mode,stripe_card_id,wallet_address) VALUES ($1,$2,'sandbox','ic_A',$3)", [id, owner, wallet]);
      await tx.unsafe(await readMigrationSql("022_card_programs.sql"));
    });
    sql = createPostgresSqlExecutor(url!, { schema });
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });
  test("backfills sandbox rows, preserves UUID and drops replaced columns", async () => {
    expect(await createCardAccountStore(sql).read(owner, "sandbox")).toEqual({ customerId: owner, mode: "sandbox", provider: "bridge",
      accountId: "bridge-A", cardholderId: "ich_A", cards: [{ id, providerCardId: "ic_A", walletAddress: wallet }] });
    expect(await createCardAccountStore(sql).read(other, "sandbox")).toBeNull();
    const columns = await sql.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('cards','card_accounts')", [schema]);
    for (const name of ["bridge_customer_id", "stripe_cardholder_id", "stripe_card_id"]) expect(columns.rows.map((row) => row.column_name)).not.toContain(name);
  });
  test("card program must match its account and provider IDs are scoped by program and mode", async () => {
    await expect(sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','immersve','other',$2)", [owner, wallet])).rejects.toThrow();
    await sql.query("INSERT INTO card_accounts(customer_id,mode,provider,provider_account_id) VALUES ($1,'sandbox','immersve','bridge-A'),($2,'production','bridge','bridge-A')", [other, owner]);
    await sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','immersve','ic_A',$2)", [other, wallet]);
    await expect(sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES (gen_random_uuid(),$1,'sandbox','bridge','ic_A',$2)", [owner, wallet])).rejects.toThrow();
    await expect(sql.query("INSERT INTO card_accounts(customer_id,mode,provider) VALUES ($1,'sandbox','bridge')", [other])).rejects.toThrow();
  });
});
