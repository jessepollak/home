import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseCustomerDetailResponse, parseCustomerSearchResponse, type CustomerSearchResponse } from "@/shared/admin-customers/contract";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readOperatorConfig } from "@/server/operator/config";
import { AdminAuditLog } from "@/server/operator-settings/audit";
import { MIGRATION_BOOTSTRAP_TIMEOUT_MS, readAllMigrationSql } from "@/tests/helpers/migrations";
import { createCustomerDetailHandler, createCustomerSearchHandler } from "./handlers";
import { AdminCustomerStore } from "./store";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim() ?? "";
const describePostgres = connectionString ? describe : describe.skip;
const schema = "admin_customer_lookup_test";
const operator = "0x1111111111111111111111111111111111111111" as const;
let admin: Bun.SQL;
let sql: SqlExecutor;

const session = (): VerifiedAccountSession => ({ user: { subject: "operator" }, smartAccount: { address: operator, chainId: BASE_CHAIN_ID }, accountProvider: "base-account" });
const config = () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator });
const auditLog = () => new AdminAuditLog(sql);
const deps = (audit: () => AdminAuditLog = auditLog) => ({ authorize: async () => session(), config, store: () => new AdminCustomerStore(sql), audit, balances: () => async () => [] });
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

async function customer(input: { at: string; email?: [string, "cdp_verified" | "wallet_reported"]; wallet?: string; status?: string; provider?: "cdp-embedded" | "base-account" }): Promise<string> {
  const id = randomUUID();
  const credential = randomUUID();
  await sql.query("INSERT INTO customers (id,status,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,$2,$3,$3,'sign_in')", [id, input.status ?? "active", input.at]);
  await sql.query("INSERT INTO customer_credentials (id,customer_id,account_provider,subject,email,email_source,first_seen_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
    [credential, id, input.provider ?? "cdp-embedded", `subject-${id}`, input.email?.[0] ?? null, input.email?.[1] ?? null, input.at]);
  if (input.wallet) await sql.query("INSERT INTO customer_wallets (id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,8453,$4)", [randomUUID(), id, credential, input.wallet]);
  return id;
}

async function fundingOrder(customerId: string, input: { state: string; sandbox?: boolean; providerOrderId?: string; transactionHash?: string }): Promise<string> {
  const id = randomUUID();
  await sql.query(`INSERT INTO funding_orders (id,owner_subject,account_provider,destination,provider_id,region,asset_id,payment_method,fiat_amount,intent_digest,quote,quote_token,state,creation_block,provider_order_id,transaction_hash,log_index,sandbox,customer_id,created_at,updated_at)
    VALUES ($1,'owner','cdp-embedded',$2,'coinbase','US','usdc','card','25.00',$9,'{}'::jsonb,'token',$3,1,$4,$5,$6,$7,$8,now(),now())`,
  [id, wallet(9), input.state, input.providerOrderId ?? null, input.transactionHash ?? null, input.transactionHash ? 0 : null, input.sandbox ?? false, customerId, id]);
  return id;
}

async function search(params: string, audit?: () => AdminAuditLog): Promise<{ status: number; body: CustomerSearchResponse | null; raw: unknown }> {
  const body = { version: 1, ...Object.fromEntries(new URLSearchParams(params)) };
  const response = await createCustomerSearchHandler(deps(audit))(new Request("https://home.test/api/admin/customers", {
    method: "POST", headers: { origin: "https://home.test", "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const raw: unknown = await response.json();
  return { status: response.status, body: parseCustomerSearchResponse(raw), raw };
}

describePostgres("admin customer lookup against PostgreSQL", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await transaction.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(connectionString, { schema });
  }, MIGRATION_BOOTSTRAP_TIMEOUT_MS);
  beforeEach(async () => {
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe("TRUNCATE customers, funding_orders, actions, admin_audit_log CASCADE");
    });
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("each search path finds its customer, and a customer without email stays findable", async () => {
    const withEmail = await customer({ at: "2026-01-01T00:00:00Z", email: ["ada@example.test", "wallet_reported"], wallet: wallet(0xabcdef01) });
    const noEmail = await customer({ at: "2026-01-02T00:00:00Z", wallet: wallet(0xfeed), provider: "base-account" });
    const order = await fundingOrder(noEmail, { state: "received", providerOrderId: "PROV-77", transactionHash: hash(5) });
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,created_at,confirmed_at,transaction_hash,customer_id)
      VALUES ($1,'owner','base-account','send','{"title":"Send","amounts":[],"warnings":[],"expiresAt":"2099-01-01T00:00:00Z"}'::jsonb,now(),now(),$2,$3)`, [randomUUID(), hash(0xAB).toUpperCase().replace("0X", "0x"), withEmail]);

    const found = async (q: string) => (await search(`q=${encodeURIComponent(q)}`)).body?.customers.map((row) => row.customerId);
    expect(await found("ADA@exa")).toEqual([withEmail]);
    expect(await found(wallet(0xfeed))).toEqual([noEmail]);
    expect(await found(`0x${"0".repeat(32)}abcd`)).toEqual([withEmail]);
    expect(await found(hash(0xab))).toEqual([withEmail]);
    expect(await found(hash(5))).toEqual([noEmail]);
    expect(await found(order)).toEqual([noEmail]);
    expect(await found("PROV-77")).toEqual([noEmail]);
    expect(await found(noEmail.toUpperCase())).toEqual([noEmail]);
    expect(await found("ada_")).toEqual([]);
    const uuidProviderOrder = randomUUID();
    await fundingOrder(withEmail, { state: "pending", providerOrderId: uuidProviderOrder });
    expect(await found(uuidProviderOrder)).toEqual([withEmail]);
    const apostrophe = await customer({ at: "2026-01-03T00:00:00Z", email: ["o'connor@example.test", "cdp_verified"] });
    expect(await found("O'Connor@example.test")).toEqual([apostrophe]);
    const rows = (await search(`q=${encodeURIComponent("ada@")}`)).body?.customers;
    expect(rows?.[0]?.emails).toEqual([{ address: "ada@example.test", source: "wallet_reported" }]);
  });

  test("funded excludes sandbox and unreceived orders, and keyset pages do not skip ties", async () => {
    const tie = "2026-02-01T00:00:00Z";
    const ids = await Promise.all(Array.from({ length: 30 }, () => customer({ at: tie })));
    const [real = "", sandbox = "", pending = ""] = ids;
    await fundingOrder(real, { state: "received" });
    await fundingOrder(sandbox, { state: "received", sandbox: true });
    await fundingOrder(pending, { state: "pending" });
    expect((await search("funded=funded")).body?.customers.map((row) => row.customerId)).toEqual([real]);
    const first = (await search("")).body;
    expect(first?.customers).toHaveLength(25);
    const second = (await search(`after=${first?.nextCursor}`)).body;
    expect(second?.nextCursor).toBeNull();
    expect(new Set([...first?.customers ?? [], ...second?.customers ?? []].map((row) => row.customerId))).toEqual(new Set(ids));
  });

  test("listed and detailed customers are audited before disclosure, and audit failure discloses nothing", async () => {
    const id = await customer({ at: "2026-03-01T00:00:00Z", email: ["grace@example.test", "cdp_verified"] });
    expect((await search("q=grace")).status).toBe(200);
    expect((await search("q=grace")).status).toBe(200);
    const down: SqlExecutor = { query: async () => { throw new Error("audit down"); }, transaction: async () => { throw new Error("audit down"); } };
    const failing = () => new AdminAuditLog(down);
    const failed = await search("q=grace", failing);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.raw)).not.toContain("grace");
    const detail = createCustomerDetailHandler(deps(failing));
    const blocked = await detail(new Request(`https://home.test/api/admin/customers/${id}`), { params: Promise.resolve({ id }) });
    expect(blocked.status).toBe(503);
    expect(await blocked.text()).not.toContain("grace");
    const shown = await createCustomerDetailHandler(deps())(new Request(`https://home.test/api/admin/customers/${id}`), { params: Promise.resolve({ id }) });
    expect(parseCustomerDetailResponse(await shown.json())?.profile.credentials[0]?.email).toEqual({ address: "grace@example.test", source: "cdp_verified" });
    const audited = await sql.query<{ purpose: string }>("SELECT purpose FROM admin_audit_log WHERE target_id=$1 ORDER BY id", [id]);
    expect(audited.rows.map((row) => row.purpose)).toEqual(["customer-search", "customer-search", "customer-detail"]);
  });
});
