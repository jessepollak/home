import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { PostgresFundingProviderCustomerStore } from "./customer-store";

const connectionString = process.env.FUNDING_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const TEST_SCHEMA = "funding_customer_contract_test";
type BunSqlClient = {
  unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>;
  begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

let admin: BunSqlClient;
let sql: SqlExecutor;
let store: PostgresFundingProviderCustomerStore;
let customerMigration: string;

const owner = { subject: "customer-owner", accountProvider: "base-account" as const };
const createdAt = "2026-09-18T00:00:00.000Z";

function reservation(overrides: Partial<{
  id: string;
  owner: typeof owner;
  providerId: string;
  region: string;
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    owner: overrides.owner ?? owner,
    providerId: overrides.providerId ?? "ripio",
    region: overrides.region ?? "AR",
    createdAt,
  };
}

async function inTestSchema(text: string): Promise<void> {
  await admin.begin(async (transaction) => {
    await transaction.unsafe(`SET LOCAL search_path TO ${TEST_SCHEMA}`);
    await transaction.unsafe(text);
  });
}

describePostgres("PostgresFundingProviderCustomerStore production contract", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const orderMigration = await readFile(resolve(import.meta.dir, "../migrations/002_funding_provider_seam.sql"), "utf8");
    customerMigration = await readFile(resolve(import.meta.dir, "../migrations/007_funding_provider_customers.sql"), "utf8");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await inTestSchema(orderMigration);
    await inTestSchema(customerMigration);
    sql = createPostgresSqlExecutor(connectionString!, { schema: TEST_SCHEMA });
    store = new PostgresFundingProviderCustomerStore(sql);
  });

  beforeEach(async () => {
    await sql.query("TRUNCATE funding_provider_customers, funding_orders");
  });

  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin?.close();
  });

  test("loads migration 007 and drops a conflicting legacy owner tuple fail-closed", async () => {
    for (const subject of ["legacy-owner-a", "legacy-owner-b"]) {
      await sql.query(`INSERT INTO funding_orders (
        id, owner_subject, account_provider, destination, provider_id, region,
        asset_id, payment_method, fiat_amount, intent_digest, quote, quote_token,
        customer_ref, state, creation_block, created_at, updated_at
      ) VALUES ($1,$2,'base-account','0x1111111111111111111111111111111111111111',
        'ripio','AR','base:wars','bank','100',$3,'{}'::jsonb,$4,
        'shared-provider-customer','awaiting-payment',1,$5,$5)`,
      [randomUUID(), subject, randomUUID(), `token-${subject}`, createdAt]);
    }

    await inTestSchema(customerMigration);
    const migrated = await sql.query("SELECT owner_subject, state, customer_ref FROM funding_provider_customers");
    expect(migrated.rows).toHaveLength(1);
    expect(migrated.rows[0]).toMatchObject({ state: "pending", customer_ref: "shared-provider-customer" });
    const columns = await admin.unsafe("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'funding_provider_customers'", [TEST_SCHEMA]);
    expect(Array.from(columns, (row) => (row as { column_name: string }).column_name)).not.toContain("provider_created_at");
    expect(Array.from(columns, (row) => (row as { column_name: string }).column_name)).not.toContain("provider_submission_ref");
  });

  test("single-flights reservations, isolates owners, and applies create and verification CAS", async () => {
    const first = reservation();
    const second = { ...first, id: randomUUID() };
    const results = await Promise.all([store.reserve(first), store.reserve(second)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].customer.id).toBe(results[1].customer.id);
    expect(await store.get({ subject: "other-owner", accountProvider: "base-account" }, "ripio", "AR")).toBeNull();
    expect(await store.list({ subject: "other-owner", accountProvider: "base-account" }, "AR")).toEqual([]);

    const id = results[0].customer.id;
    const pending = await store.completeCreate(id, {
      customerRef: "provider-customer",
      expectedVersion: 0,
      updatedAt: "2026-09-18T00:00:01.000Z",
    });
    expect(pending).toMatchObject({ state: "pending", customerRef: "provider-customer", version: 1 });
    const claims = await Promise.all([
      store.claimVerification(id, pending!.version, "2026-09-18T00:00:02.000Z"),
      store.claimVerification(id, pending!.version, "2026-09-18T00:00:02.000Z"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find(Boolean)!;
    const verified = await store.markVerified(id, claimed.version, "2026-09-18T00:00:03.000Z");
    expect(verified).toMatchObject({ state: "verified", version: 3 });
    expect(await store.markVerified(id, claimed.version, "2026-09-18T00:00:04.000Z")).toBeNull();
  });

  test("persists ambiguous and rejected transitions and enforces state and identity constraints", async () => {
    const ambiguousInput = reservation({ providerId: "ambiguous-provider" });
    await store.reserve(ambiguousInput);
    expect((await store.markDispatchAmbiguous(ambiguousInput.id, 0, "2026-09-18T00:01:00.000Z"))?.state).toBe("dispatch-ambiguous");
    expect(await store.completeCreate(ambiguousInput.id, {
      customerRef: "late-customer",
      expectedVersion: 1,
      updatedAt: "2026-09-18T00:01:01.000Z",
    })).toBeNull();

    const createRejectedInput = reservation({ providerId: "create-rejected-provider" });
    await store.reserve(createRejectedInput);
    expect((await store.markRejected(createRejectedInput.id, 0, "2026-09-18T00:02:00.000Z"))?.state).toBe("rejected");

    const verificationRejectedInput = reservation({ providerId: "verification-rejected-provider" });
    await store.reserve(verificationRejectedInput);
    const pending = await store.completeCreate(verificationRejectedInput.id, {
      customerRef: "verification-customer",
      expectedVersion: 0,
      updatedAt: "2026-09-18T00:03:00.000Z",
    });
    const claimed = await store.claimVerification(verificationRejectedInput.id, pending!.version, "2026-09-18T00:03:01.000Z");
    expect((await store.markRejected(verificationRejectedInput.id, claimed!.version, "2026-09-18T00:03:02.000Z"))?.state).toBe("rejected");
    expect(await store.markDispatchAmbiguous(verificationRejectedInput.id, claimed!.version + 1, "2026-09-18T00:03:03.000Z")).toBeNull();

    await expect(sql.query(`INSERT INTO funding_provider_customers (
      id, owner_subject, account_provider, provider_id, region, state, created_at, updated_at
    ) VALUES ($1,'invalid-owner','base-account','ripio','AR','pending',$2,$2)`, [randomUUID(), createdAt])).rejects.toThrow();

    const duplicate = reservation({
      owner: { subject: "duplicate-owner", accountProvider: "base-account" },
      providerId: "verification-rejected-provider",
    });
    await store.reserve(duplicate);
    await expect(store.completeCreate(duplicate.id, {
      customerRef: "verification-customer",
      expectedVersion: 0,
      updatedAt: "2026-09-18T00:04:00.000Z",
    })).rejects.toThrow();
  });
});
