import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { OPERATOR_FEE_TOKEN } from "@/shared/fees/contract";
import { ActionsStore } from "./store";
import { readOperatorRevenue } from "@/server/fees/revenue";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "action_fees_test";
type BunSqlClient = { unsafe(text: string): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
const owner = { subject: "fee-test", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const recipient = "0x2222222222222222222222222222222222222222" as const;
const fee = { amountBaseUnits: "9007199254740993", token: OPERATOR_FEE_TOKEN, bps: 100, recipient, collectedBy: "in-batch-transfer" as const };
let admin: BunSqlClient;
let sql: SqlExecutor;
let store: ActionsStore;

async function insertAction(kind: "trade" | "send", operatorFee: unknown = fee): Promise<string> {
  const id = randomUUID();
  await store.insert({ id, owner, kind, summary: {
    title: "Action", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
    metadata: kind === "trade" ? { product: "trade", ...(operatorFee === "none" ? {} : { operatorFee }) } as never : undefined,
  }, pending: { calls: [{ to: owner.address, data: "0x1234", value: "0" }] }, createdAt: "2026-09-25T10:00:00.000Z" });
  return id;
}

describePostgres("operator fee records and revenue", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const name of ["001_actions.sql", "012_action_outcomes.sql", "013_action_call_commitment.sql", "014_cashout_orders.sql"]) {
        await transaction.unsafe(await readMigrationSql(name));
      }
      for (const name of ["002_funding_provider_seam.sql", "007_funding_provider_customers.sql", "008_funding_provider_user_tokens.sql", "011_operator_registry.sql", "017_record_customer_ids.sql", "018_operator_fee_records.sql"]) {
        await transaction.unsafe(await readMigrationSql(name));
      }
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema });
    store = new ActionsStore(sql);
  });
  beforeEach(async () => { await sql.query("TRUNCATE actions CASCADE"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("confirmation atomically writes one normalized trade fee and replay leaves it unchanged", async () => {
    const id = await insertAction("trade");
    expect(await store.confirm(owner, id)).not.toBeNull();
    const first = await sql.query<{ action_id: string; action_kind: string; amount_base_units: string; token_asset_id: string; token_address: string; token_decimals: number; bps: number; recipient: string; collected_by: string }>(
      "SELECT action_id, action_kind, amount_base_units::text, token_asset_id, token_address, token_decimals, bps, recipient, collected_by FROM operator_fee_records WHERE action_id = $1", [id]);
    expect(first.rows).toEqual([{ action_id: id, action_kind: "trade", amount_base_units: "9007199254740993", token_asset_id: "usdc", token_address: OPERATOR_FEE_TOKEN.address,
      token_decimals: 6, bps: 100, recipient, collected_by: "in-batch-transfer" }]);
    await store.confirm(owner, id);
    expect((await sql.query("SELECT 1 FROM operator_fee_records WHERE action_id = $1", [id])).rows).toHaveLength(1);
  });

  test("zero-fee trades and other action kinds do not write a record", async () => {
    const zero = await insertAction("trade", "none");
    const send = await insertAction("send");
    await store.confirm(owner, zero);
    await store.confirm(owner, send);
    expect((await sql.query("SELECT 1 FROM operator_fee_records")).rows).toHaveLength(0);
  });

  test("invalid fee metadata rolls back confirmation", async () => {
    const id = await insertAction("trade", { ...fee, amountBaseUnits: "0" });
    await expect(store.confirm(owner, id)).rejects.toThrow("Invalid operator fee record");
    expect((await store.get(owner, id))?.confirmed_at).toBeNull();
    expect((await sql.query("SELECT 1 FROM operator_fee_records WHERE action_id = $1", [id])).rows).toHaveLength(0);
  });
  test("a fee recipient equal to the action owner rolls back confirmation", async () => {
    const id = await insertAction("trade", { ...fee, recipient: owner.address });
    await expect(store.confirm(owner, id)).rejects.toThrow("Invalid operator fee record");
    expect((await store.get(owner, id))?.confirmed_at).toBeNull();
    expect((await sql.query("SELECT 1 FROM operator_fee_records WHERE action_id = $1", [id])).rows).toHaveLength(0);
  });

  test("a rejected fee record insert rolls back confirmation", async () => {
    const id = await insertAction("trade");
    await sql.query("ALTER TABLE operator_fee_records RENAME TO operator_fee_records_fenced");
    try {
      await expect(store.confirm(owner, id)).rejects.toThrow();
    } finally {
      await sql.query("ALTER TABLE operator_fee_records_fenced RENAME TO operator_fee_records");
    }
    expect((await store.get(owner, id))?.confirmed_at).toBeNull();
    expect((await sql.query("SELECT 1 FROM operator_fee_records WHERE action_id = $1", [id])).rows).toHaveLength(0);
  });

  test("revenue counts only succeeded outcomes, zero-fills UTC days and reads current hash and outcome from actions", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => insertAction("trade")));
    for (const id of ids) await store.confirm(owner, id);
    const amounts = ["9007199254740993", "8", "10", "11", "13"];
    for (let index = 0; index < ids.length; index++) {
      await sql.query("UPDATE operator_fee_records SET amount_base_units = $2::numeric, recorded_at = $3::timestamptz WHERE action_id = $1",
        [ids[index], amounts[index], `2026-09-${24 + index}T12:00:00.000Z`]);
    }
    const hash = `0x${"AB".repeat(32)}`;
    const normalizedHash = hash.toLowerCase() as `0x${string}`;
    await sql.query("UPDATE actions SET outcome = 'succeeded', outcome_source = 'chain', outcome_recorded_at = '2026-09-27T00:15:00Z', settled_at = now(), transaction_hash = $2 WHERE id = $1", [ids[0], hash]);
    await sql.query("UPDATE actions SET outcome = 'succeeded', outcome_source = 'chain', outcome_recorded_at = '2026-09-25T23:15:00Z', settled_at = now() WHERE id = $1", [ids[1]]);
    await sql.query("UPDATE actions SET outcome = 'reverted', outcome_source = 'chain', outcome_recorded_at = now(), settled_at = now(), transaction_hash = $2 WHERE id = $1", [ids[2], hash]);
    await sql.query("UPDATE actions SET outcome = 'not_submitted', outcome_source = 'wallet', outcome_recorded_at = now() WHERE id = $1", [ids[3]]);
    const summary = await readOperatorRevenue(sql, { now: new Date("2026-09-28T23:59:59Z"), days: 5, limit: 5 });
    expect(summary.collectedBaseUnits).toBe("9007199254741001");
    expect(summary.days).toEqual([
      { date: "2026-09-24", collectedBaseUnits: "0" },
      { date: "2026-09-25", collectedBaseUnits: "8" },
      { date: "2026-09-26", collectedBaseUnits: "0" },
      { date: "2026-09-27", collectedBaseUnits: "9007199254740993" },
      { date: "2026-09-28", collectedBaseUnits: "0" },
    ]);
    expect(summary.entries.map(({ actionId, result, transactionHash }) => ({ actionId, result, transactionHash }))).toEqual([
      { actionId: ids[4], result: "unresolved", transactionHash: null },
      { actionId: ids[3], result: "not_submitted", transactionHash: null },
      { actionId: ids[2], result: "reverted", transactionHash: normalizedHash },
      { actionId: ids[1], result: "succeeded", transactionHash: null },
      { actionId: ids[0], result: "succeeded", transactionHash: normalizedHash },
    ]);
    expect((await readOperatorRevenue(sql, { now: new Date("2026-09-28T00:00:00Z"), days: 1, limit: 1 })).entries).toHaveLength(1);
  });

  test("a provider-native fee persists its collection method and counts toward revenue once succeeded", async () => {
    const id = await insertAction("trade", { ...fee, collectedBy: "provider-native" });
    await store.confirm(owner, id);
    expect((await sql.query<{ collected_by: string }>("SELECT collected_by FROM operator_fee_records WHERE action_id = $1", [id])).rows)
      .toEqual([{ collected_by: "provider-native" }]);
    await sql.query("UPDATE actions SET outcome = 'succeeded', outcome_source = 'chain', outcome_recorded_at = now(), settled_at = now() WHERE id = $1", [id]);
    const summary = await readOperatorRevenue(sql, { now: new Date("2026-09-27T12:00:00Z"), days: 1, limit: 5 });
    expect(summary.collectedBaseUnits).toBe(fee.amountBaseUnits);
    expect(summary.entries.map(({ actionId, collectedBy, result }) => ({ actionId, collectedBy, result })))
      .toEqual([{ actionId: id, collectedBy: "provider-native", result: "succeeded" }]);
  });

  test("an action that is not a trade writes no record even when its summary carries fee metadata", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary: {
      title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
      metadata: { product: "trade", operatorFee: fee } as never,
    }, pending: { calls: [{ to: owner.address, data: "0x1234", value: "0" }] }, createdAt: "2026-09-25T10:00:00.000Z" });
    expect(await store.confirm(owner, id)).not.toBeNull();
    expect((await sql.query("SELECT 1 FROM operator_fee_records")).rows).toHaveLength(0);
  });
});
