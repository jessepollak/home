import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { backfillOperatorRegistry } from "@/server/operator-events/backfill";
import { CustomerResolver } from "./resolve";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "operator_registry_contract_test";
type Admin = { unsafe(text: string): Promise<unknown>; begin<T>(run: (tx: Admin) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: Admin;
let sql: SqlExecutor;
let registry: CustomerResolver;
const address = "0x1111111111111111111111111111111111111111" as const;
const at = new Date("2026-09-12T00:00:00Z");
const owner = { accountProvider: "cdp-embedded" as const, subject: "operator-test", address };

function session(input: { accountProvider: "cdp-embedded" | "base-account"; subject: string; address?: `0x${string}` | null }) {
  return { accountProvider: input.accountProvider, user: { subject: input.subject },
    smartAccount: input.address ? { chainId: 8453 as const, address: input.address } : null };
}

async function rows<T = Record<string, unknown>>(table: string): Promise<T[]> {
  return (await sql.query<T>(`SELECT * FROM ${table}`)).rows;
}

async function signIn(input: Parameters<typeof session>[0] = owner, options: { at?: Date; email?: string | null; country?: string | null } = {}) {
  return registry.resolveCustomer(session(input), { create: true, at: options.at ?? at, email: options.email, country: options.country });
}

describePostgres("customer registry PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as Admin;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of [
        "001_actions.sql", "002_funding_provider_seam.sql", "003_coinbase_hosted_retired.sql",
        "004_funding_sandbox.sql", "007_funding_provider_customers.sql",
        "008_funding_provider_user_tokens.sql", "011_operator_registry.sql",
      ]) await tx.unsafe(await readMigrationSql(migration));
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    registry = new CustomerResolver(sql);
  });
  beforeEach(async () => { await sql.query("DELETE FROM customers"); await sql.query("TRUNCATE actions, funding_orders, funding_provider_customers CASCADE"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("repeat sign-ins across providers create one customer and credential per provider subject", async () => {
    const first = await signIn();
    const later = await signIn(owner, { at: new Date("2026-09-13T00:00:00Z") });
    await signIn(owner, { at: new Date("2026-09-14T00:00:00Z") });
    await signIn({ ...owner, accountProvider: "base-account" });
    const customers = await rows<{ id: string; first_seen_at: Date; last_seen_at: Date }>("customers");
    expect(first.created).toBe(true);
    expect(later).toEqual({ id: first.id, status: "active", created: false });
    expect(customers).toHaveLength(2);
    expect(await rows("customer_credentials")).toHaveLength(2);
    expect(customers.find((row) => row.id === first.id)?.first_seen_at.toISOString()).toBe(at.toISOString());
    expect(customers.find((row) => row.id === first.id)?.last_seen_at.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect((await rows<{ customer_id: string }>("customer_wallets"))[0].customer_id).toBe(first.id);
    expect(await rows("operator_events")).toHaveLength(2);
  });

  test("concurrent first use creates one customer credential and signup", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => signIn()));
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await rows("customers")).toHaveLength(1);
    expect(await rows("customer_credentials")).toHaveLength(1);
    expect(await rows("operator_events")).toHaveLength(1);
  });

  test("provisioning CDP session has no wallet until a later sign-in", async () => {
    const first = await signIn({ ...owner, address: null });
    expect(await rows("customer_wallets")).toHaveLength(0);
    const later = await signIn();
    expect(later.id).toBe(first.id);
    expect((await rows<{ customer_id: string; address: string }>("customer_wallets"))[0]).toMatchObject({ customer_id: first.id, address });
  });

  test("read-only resolution does not create any rows and returns an existing customer", async () => {
    expect(await registry.resolveCustomer(session(owner), { create: false })).toBeNull();
    expect(await rows("customers")).toHaveLength(0);
    expect(await rows("customer_credentials")).toHaveLength(0);
    expect(await rows("operator_events")).toHaveLength(0);
    const created = await signIn();
    expect(await registry.resolveCustomer(session(owner), { create: false })).toEqual({ id: created.id, status: "active", created: false });
  });

  test("older sign-in lowers seen times but cannot replace newer email and country", async () => {
    const laterAt = new Date("2026-09-13T00:00:00Z");
    await signIn(owner, { at: laterAt, email: "new@example.com", country: "DE" });
    await signIn(owner, { email: "old@example.com", country: "US" });
    expect((await rows<{ first_seen_at: Date; last_seen_at: Date; country: string }>("customers"))[0]).toMatchObject({
      first_seen_at: at, last_seen_at: laterAt, country: "DE",
    });
    expect((await rows<{ email: string; email_source: string }>("customer_credentials"))[0]).toMatchObject({ email: "new@example.com", email_source: "cdp_verified" });
  });

  test("older sign-in fills missing email and country and verified email supersedes reported email", async () => {
    const laterAt = new Date("2026-09-13T00:00:00Z");
    await signIn(owner, { at: laterAt });
    await sql.query("UPDATE customer_credentials SET email='wallet@example.com',email_source='wallet_reported'");
    await signIn(owner, { email: "CDP@EXAMPLE.COM", country: "US" });
    expect((await rows<{ country: string }>("customers"))[0].country).toBe("US");
    expect((await rows<{ email: string; email_source: string }>("customer_credentials"))[0]).toMatchObject({ email: "cdp@example.com", email_source: "cdp_verified" });
    await signIn({ ...owner, accountProvider: "base-account" }, { email: "unverified@example.com" });
    expect((await sql.query<{ email: string | null }>("SELECT email FROM customer_credentials WHERE account_provider='base-account'")).rows[0].email).toBeNull();
  });

  test("retries of every event insert once; activity signup lowers first seen without bumping last seen", async () => {
    const laterAt = new Date("2026-09-13T00:00:00Z");
    await signIn(owner, { at: laterAt });
    for (const name of ["funding.order_created", "funding.order_finalized", "action.confirmed", "verification.changed"] as const) {
      const event = { owner, name, idempotencyKey: `${name}:test`, occurredAt: at, props: { state: "pending" } };
      expect(await registry.record(event)).toBe(true);
      expect(await registry.record(event)).toBe(false);
    }
    expect((await rows<{ first_seen_at: Date; last_seen_at: Date }>("customers"))[0]).toMatchObject({ first_seen_at: at, last_seen_at: laterAt });
    expect(await rows("operator_events")).toHaveLength(5);
  });

  test("activity first use creates the customer and signup", async () => {
    await registry.record({ owner, name: "action.confirmed", idempotencyKey: "activity-first", occurredAt: at, props: {} });
    expect((await rows<{ first_seen_source: string }>("customers"))[0].first_seen_source).toBe("activity");
    expect(await rows("operator_events")).toHaveLength(2);
  });

  test("direct update delete and truncate of events fail; deleting customer cascades all owned rows", async () => {
    const { id } = await signIn();
    await expect(sql.query("UPDATE operator_events SET sandbox=true")).rejects.toThrow("operator events are append-only");
    await expect(sql.query("DELETE FROM operator_events")).rejects.toThrow("operator events are append-only");
    await expect(sql.query("TRUNCATE operator_events")).rejects.toThrow("operator events are append-only");
    await sql.query("DELETE FROM customers WHERE id=$1", [id]);
    for (const table of ["customers", "customer_credentials", "customer_wallets", "operator_events"]) expect(await rows(table)).toHaveLength(0);
  });

  test("backfill derives three tables and events idempotently alongside live sign-in", async () => {
    const id = randomUUID();
    const actionId = randomUUID();
    const providerCustomerId = randomUUID();
    const actionOwner = JSON.stringify(["backfill-owner", "0x2222222222222222222222222222222222222222", 8453, "cdp-embedded"]);
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,created_at,confirmed_at)
      VALUES ($1,$2,'cdp-embedded','send','{}',$3,$3)`, [actionId, actionOwner, new Date("2026-09-10T00:00:00Z")]);
    await sql.query(`INSERT INTO funding_orders
      (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,created_at,updated_at,sandbox)
      VALUES ($1,'backfill-owner','cdp-embedded',$2,'idrx','ID','base:idrx','qris','20000',$4,'{}','token','received',100,$3,$3,true)`, [id, address, at, id]);
    await sql.query(`INSERT INTO funding_provider_customers
      (id,owner_subject,account_provider,provider_id,region,customer_ref,state,created_at,updated_at)
      VALUES ($1,'kyc-owner','base-account','idrx','ID','provider-ref','pending',$2,$2)`, [providerCustomerId, at]);
    await signIn({ ...owner, accountProvider: "base-account", subject: "kyc-owner" });
    expect(await backfillOperatorRegistry(sql)).toEqual({ customers: 1, events: 5 });
    expect(await backfillOperatorRegistry(sql)).toEqual({ customers: 0, events: 0 });
    expect(await rows("customers")).toHaveLength(2);
    expect(await rows("customer_credentials")).toHaveLength(2);
    expect(await rows("customer_wallets")).toHaveLength(1);
    expect((await rows<{ address: string }>("customer_wallets"))[0].address).toBe(address);
    const backfilled = (await rows<{ first_seen_source: string; first_seen_at: Date }>("customers")).find((row) => row.first_seen_source === "backfill");
    expect(backfilled?.first_seen_at).toEqual(new Date("2026-09-10T00:00:00Z"));
    expect(await rows("operator_events")).toHaveLength(6);
  });
});
