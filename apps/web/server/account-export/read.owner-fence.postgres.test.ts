import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { AccountExportReader } from "./read";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const schema = `account_export_owner_fence_test_${randomBytes(4).toString("hex")}`;
const at = "2026-10-07T00:00:00.000Z";
const uuid = (owner: number, item: number) => `${String(owner).repeat(8)}-${String(owner).repeat(4)}-4${String(owner).repeat(3)}-8${String(owner).repeat(3)}-${String(item).padStart(12, "0")}`;
const address = (owner: number): `0x${string}` => `0x${String(owner).repeat(40)}`;
const session = (owner: number): VerifiedAccountSession => ({ accountProvider: "base-account", user: { subject: `export-owner-${owner}` }, smartAccount: { chainId: 8453, address: address(owner) } });
let admin: Bun.SQL;
let sql: SqlExecutor;
let reader: AccountExportReader;

async function seed(owner: number) {
  const customer = uuid(owner, 1), credential = uuid(owner, 2), wallet = uuid(owner, 3), card = uuid(owner, 6);
  await sql.query("INSERT INTO customers (id,country,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,'US',$2,$2,'sign_in')", [customer, at]);
  await sql.query("INSERT INTO customer_credentials (id,customer_id,account_provider,subject,email,email_source,first_seen_at,last_seen_at) VALUES ($1,$2,'base-account',$3,$4,'wallet_reported',$5,$5)", [credential, customer, `export-owner-${owner}`, `owner${owner}@example.test`, at]);
  await sql.query("INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,8453,$4)", [wallet, customer, credential, address(owner)]);
  await sql.query("INSERT INTO card_accounts(customer_id,mode,provider,provider_account_id,provider_cardholder_id) VALUES ($1,'sandbox','bridge',$2,$3)", [customer, `bridge-${owner}`, `holder-${owner}`]);
  await sql.query("INSERT INTO cards(id,customer_id,mode,provider,provider_card_id,wallet_address) VALUES ($1,$2,'sandbox','bridge',$3,$4)", [card, customer, `stripe-${owner}`, address(owner)]);
  await sql.query(`INSERT INTO card_events(provider,mode,event_id,kind,cardholder_account_id,customer_id,card_id,occurred_at) VALUES
    ('bridge','sandbox',$1,'purchase',$2,$3,$4,$5),
    ('bridge','sandbox',$6,'purchase',NULL,NULL,$4,$5),
    ('bridge','sandbox',$7,'issuing_cardholder.created',$2,NULL,NULL,$5)`, [`event-${owner}`, `holder-${owner}`, `bridge-${owner}`, `stripe-${owner}`, at, `stripe-event-${owner}`, `holder-only-${owner}`]);
}

(connectionString ? describe : describe.skip)("account export PostgreSQL card-event owner fence", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("FUNDING_PG_TEST_URL is required");
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await tx.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(connectionString, { poolFactory: (config) => new Pool({ ...config, options: `-c search_path=${schema}` }) });
    reader = new AccountExportReader(sql);
    await seed(1);
    await seed(2);
    await sql.query(`INSERT INTO card_events(provider,mode,event_id,kind,cardholder_account_id,customer_id,card_id,occurred_at) VALUES
      ('bridge','production','holder-wrong-mode','issuing_cardholder.created','holder-1',NULL,NULL,$1),
      ('immersve','sandbox','holder-wrong-provider','issuing_cardholder.created','holder-1',NULL,NULL,$1)`, [at]);
  });
  afterAll(async () => { await sql?.dispose?.(); await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.close(); });

  test("exports only the owner's provider-mode cardholder and card events without duplicates", async () => {
    const body = await reader.read(session(1));
    const events = body.classes.find((entry) => entry.name === "card_events");
    expect(events?.records.map((event) => `${event.provider}:${event.mode}:${event.eventId}`).sort()).toEqual([
      "bridge:sandbox:event-1",
      "bridge:sandbox:holder-only-1",
      "bridge:sandbox:stripe-event-1",
    ]);
    await expect(new AccountExportReader(sql, 2).read(session(1))).rejects.toMatchObject({ code: "ACCOUNT_EXPORT_TOO_LARGE" });
  });
});
