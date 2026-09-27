import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { ActionsStore, actionOwnerKey } from "@/server/actions/store";
import { PostgresFundingOrderStore } from "@/server/funding/core/postgres-store";
import { PostgresFundingProviderCustomerStore } from "@/server/funding/core/customer-store";
import { PostgresFundingProviderUserTokenStore } from "@/server/funding/core/user-token-store";
import { resolveSecretKeyring, sealSecret } from "@/server/secrets/at-rest";
import { CustomerResolver } from "./resolve";
import { backfillRecordCustomerIds } from "./record-ids-backfill";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const postgres = connectionString ? describe : describe.skip;
const schema = "record_customer_ids_test";
const address = "0x1111111111111111111111111111111111111111" as const;
const otherAddress = "0x2222222222222222222222222222222222222222" as const;
const at = "2026-09-12T00:00:00.000Z";
const owner = { subject: "record-one", accountProvider: "cdp-embedded" as const, address, chainId: 8453 as const };
const other = { ...owner, subject: "record-two", accountProvider: "base-account" as const };
let admin: Bun.SQL;
let sql: SqlExecutor;
let actions: ActionsStore;
let orders: PostgresFundingOrderStore;
let customers: PostgresFundingProviderCustomerStore;
let tokens: PostgresFundingProviderUserTokenStore;
let registry: CustomerResolver;

function reservation(subject = owner.subject, destination: typeof address | typeof otherAddress = address) {
  return { id: randomUUID(), owner: { subject, accountProvider: owner.accountProvider }, destination,
    providerId: "idrx", region: "ID", assetId: "base:idrx", paymentMethod: "qris", fiatAmount: "20000",
    intentDigest: randomUUID(), quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    quoteToken: "signed", customerRef: null, sandbox: false, creationBlock: "100", createdAt: at };
}
async function ids(table: string, where: string, value: string) {
  return (await sql.query<{ customer_id: string | null; credential_id: string | null; wallet_id: string | null }>(
    `SELECT customer_id,credential_id,wallet_id FROM ${table} WHERE ${where}=$1`, [value],
  )).rows[0];
}

postgres("record customer ids PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const file of ["001_actions.sql", "002_funding_provider_seam.sql", "003_coinbase_hosted_retired.sql",
        "004_funding_sandbox.sql", "007_funding_provider_customers.sql", "008_funding_provider_user_tokens.sql",
        "011_operator_registry.sql", "012_action_outcomes.sql", "013_action_call_commitment.sql", "017_record_customer_ids.sql"]) {
        await tx.unsafe(await readMigrationSql(file));
      }
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    actions = new ActionsStore(sql);
    orders = new PostgresFundingOrderStore(sql);
    customers = new PostgresFundingProviderCustomerStore(sql);
    tokens = new PostgresFundingProviderUserTokenStore(sql);
    registry = new CustomerResolver(sql);
  });
  beforeEach(async () => {
    await sql.query("TRUNCATE actions, funding_orders, funding_provider_customers, funding_provider_user_tokens CASCADE");
    await sql.query("DELETE FROM customers");
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("new action and funding records carry the resolved ids without changing owner access", async () => {
    const actionId = randomUUID();
    await actions.insert({ id: actionId, owner, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [] }, createdAt: at });
    const order = reservation();
    await orders.reserve(order);
    const customer = await customers.reserve({ id: randomUUID(), owner: { subject: owner.subject, accountProvider: owner.accountProvider }, providerId: "idrx", region: "ID", createdAt: at });
    const resolved = await registry.resolveOwner(owner, new Date(at));
    const expected = { customer_id: resolved.customerId, credential_id: resolved.credentialId, wallet_id: resolved.walletId };
    expect(resolved.walletId).not.toBeNull();
    expect(await ids("actions", "id", actionId)).toEqual(expected);
    expect(await ids("funding_orders", "id", order.id)).toEqual(expected);
    expect(await ids("funding_provider_customers", "id", customer.customer.id)).toEqual({ ...expected, wallet_id: null });
    expect(await actions.get(other, actionId)).toBeNull();
    expect(await actions.confirm(other, actionId)).toBeNull();
    expect(await orders.getOwned(order.id, other)).toBeNull();
    expect(await actions.get(owner, actionId)).not.toBeNull();
    expect(await orders.getOwned(order.id, order.owner)).not.toBeNull();
  });

  test("wallet claimed by another credential is not attached", async () => {
    const first = await registry.resolveOwner(owner, new Date(at));
    const second = await registry.resolveOwner(other, new Date(at));
    expect(first.walletId).not.toBeNull();
    expect(second.customerId).not.toBe(first.customerId);
    expect(second.walletId).toBeNull();
    const id = randomUUID();
    await actions.insert({ id, owner: other, kind: "send", summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [] }, createdAt: at });
    expect(await ids("actions", "id", id)).toEqual({ customer_id: second.customerId, credential_id: second.credentialId, wallet_id: null });
  });

  test("user token insert and envelope CAS fill nullable ids without changing owner fencing", async () => {
    const key = { owner: { subject: owner.subject, accountProvider: owner.accountProvider }, providerId: "idrx", region: "ID", sandbox: true };
    const ring = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
    if (!ring.ok) throw new Error("invalid test keyring");
    const envelope = sealSecret(ring.keyring, "test-token", { purpose: "test", binding: {} });
    const row = { destination: address, envelope, returnedAt: at, updatedAt: at };
    expect(await tokens.putIfEnvelope(key, null, row)).toBe(true);
    const expected = await registry.resolveOwner({ ...owner }, new Date(at));
    expect(await ids("funding_provider_user_tokens", "owner_subject", owner.subject)).toEqual({
      customer_id: expected.customerId, credential_id: expected.credentialId, wallet_id: expected.walletId,
    });
    await sql.query("UPDATE funding_provider_user_tokens SET customer_id=NULL,credential_id=NULL,wallet_id=NULL");
    expect(await tokens.putIfEnvelope(key, envelope, row)).toBe(true);
    expect(await ids("funding_provider_user_tokens", "owner_subject", owner.subject)).toEqual({
      customer_id: expected.customerId, credential_id: expected.credentialId, wallet_id: expected.walletId,
    });
    expect(await tokens.get({ ...key, owner: { ...key.owner, subject: other.subject } })).toBeNull();
  });

  test("registry failures leave new records unlinked without failing the insert", async () => {
    const unavailable: SqlExecutor = { query: (text, values, options) => sql.query(text, values, options),
      transaction: async () => { throw new Error("registry unavailable"); } };
    const id = randomUUID();
    await new ActionsStore(unavailable).insert({ id, owner, kind: "send",
      summary: { title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      pending: { calls: [] }, createdAt: at });
    expect(await ids("actions", "id", id)).toEqual({ customer_id: null, credential_id: null, wallet_id: null });
  });

  test("backfill fills provider customers and tokens but never attaches a different credential's wallet", async () => {
    await registry.resolveOwner(owner, new Date(at));
    const second = await registry.resolveOwner(other, new Date(at));
    const actionId = randomUUID();
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,created_at)
      VALUES ($1,$2,'base-account','send','{}',$3)`, [actionId, actionOwnerKey(other), at]);
    const providerId = randomUUID();
    await sql.query(`INSERT INTO funding_provider_customers (id,owner_subject,account_provider,provider_id,region,state,created_at,updated_at)
      VALUES ($1,$2,$3,'idrx','ID','reserving',$4,$4)`, [providerId, other.subject, other.accountProvider, at]);
    const ring = resolveSecretKeyring({ HOME_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), HOME_SECRET_KEY_VERSION: "1" });
    if (!ring.ok) throw new Error("invalid test keyring");
    const envelope = sealSecret(ring.keyring, "test-token", { purpose: "test", binding: {} });
    await sql.query(`INSERT INTO funding_provider_user_tokens
      (account_provider,owner_subject,provider_id,region,sandbox,destination,envelope,key_version,returned_at,updated_at)
      VALUES ($1,$2,'idrx','ID',true,$3,$4,1,$5,$5)`, [other.accountProvider, other.subject, address, envelope, at]);
    const result = await backfillRecordCustomerIds(sql);
    expect(result.updated).toMatchObject({ actions: 1, funding_provider_customers: 1, funding_provider_user_tokens: 1 });
    for (const [table, column, value] of [
      ["actions", "id", actionId], ["funding_provider_customers", "id", providerId],
      ["funding_provider_user_tokens", "owner_subject", other.subject],
    ]) {
      expect(await ids(table!, column!, value!)).toEqual({ customer_id: second.customerId, credential_id: second.credentialId, wallet_id: null });
    }
    expect(Object.values((await backfillRecordCustomerIds(sql)).updated).every((count) => count === 0)).toBe(true);
  });

  test("backfill existing records and missing wallets idempotently without creating customers", async () => {
    const resolved = await registry.resolveOwner(owner, new Date(at));
    const legacyId = randomUUID();
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,created_at)
      VALUES ($1,$2,'cdp-embedded','send','{}',$3)`, [legacyId, actionOwnerKey(owner), at]);
    const legacyOrder = reservation();
    await sql.query(`INSERT INTO funding_orders
      (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,created_at,updated_at,sandbox)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'reserving',$13,$14,$14,$15)`,
    [legacyOrder.id, owner.subject, owner.accountProvider, address, legacyOrder.providerId, legacyOrder.region, legacyOrder.assetId,
      legacyOrder.paymentMethod, legacyOrder.fiatAmount, legacyOrder.intentDigest, JSON.stringify(legacyOrder.quote), legacyOrder.quoteToken, 100, at, false]);
    const unknown = randomUUID();
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,created_at)
      VALUES ($1,$2,'cdp-embedded','send','{}',$3)`, [unknown, JSON.stringify(["unknown", otherAddress, 8453, "cdp-embedded"]), at]);
    const first = await backfillRecordCustomerIds(sql);
    expect(first.updated).toMatchObject({ actions: 1, funding_orders: 1 });
    expect(first.unresolved).toMatchObject({ actions: 1, funding_orders: 0 });
    expect(await ids("actions", "id", legacyId)).toEqual({ customer_id: resolved.customerId, credential_id: resolved.credentialId, wallet_id: resolved.walletId });
    expect(await ids("actions", "id", unknown)).toEqual({ customer_id: null, credential_id: null, wallet_id: null });
    expect(await sql.query("SELECT id FROM customers")).toHaveProperty("rowCount", 1);
    const second = await backfillRecordCustomerIds(sql);
    expect(Object.values(second.updated).every((count) => count === 0)).toBe(true);
    expect(second.unresolved.actions).toBe(1);
    expect(await actions.get(other, legacyId)).toBeNull();
    expect(await actions.confirm(other, legacyId)).toBeNull();
    expect(await orders.getOwned(legacyOrder.id, other)).toBeNull();
    expect(await actions.get(owner, legacyId)).not.toBeNull();
    expect(await orders.getOwned(legacyOrder.id, legacyOrder.owner)).not.toBeNull();
    await sql.query("UPDATE actions SET wallet_id=NULL WHERE id=$1", [legacyId]);
    expect((await backfillRecordCustomerIds(sql)).updated.actions).toBe(1);
    expect(await ids("actions", "id", legacyId)).toMatchObject({ wallet_id: resolved.walletId });
  });
});
