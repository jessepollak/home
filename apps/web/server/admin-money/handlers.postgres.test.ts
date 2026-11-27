import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ActionsStore } from "@/server/actions/store";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readOperatorRevenue } from "@/server/fees/revenue";
import { readOperatorConfig } from "@/server/operator/config";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseAdminMoneyErrorResponse } from "@/shared/admin-money/contract";
import { OPERATOR_FEE_TOKEN } from "@/shared/fees/contract";
import { MIGRATION_BOOTSTRAP_TIMEOUT_MS, readAllMigrationSql } from "@/tests/helpers/migrations";
import { createMoneyExportHandler } from "./handlers";
import { listMoneyMovements } from "./movements";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim() ?? "";
const describePostgres = connectionString ? describe : describe.skip;
const schema = "admin_money_test";
const admin = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const payoutSigner = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const owner = { subject: "money-test", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const recipient = "0x2222222222222222222222222222222222222222" as const;
let client: Bun.SQL;
let sql: SqlExecutor;
let store: ActionsStore;

function session(address: `0x${string}`): VerifiedAccountSession {
  return { user: { subject: `money-${address}` }, smartAccount: { address, chainId: BASE_CHAIN_ID }, accountProvider: "base-account" };
}

function exportRequest(body: unknown) {
  return new Request("https://home.test/api/admin/money/export", {
    method: "POST", headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function handler(address: `0x${string}`) {
  return createMoneyExportHandler({ authorize: async () => session(address), config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: admin }), sql: () => sql });
}

async function feeAction(amountBaseUnits: string, recordedAt: string): Promise<string> {
  const id = randomUUID();
  await store.insert({ id, owner, kind: "trade", summary: { title: "Swap", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    pending: { calls: [{ to: owner.address, data: "0x1234", value: "0" }] }, createdAt: "2026-03-01T10:00:00.000Z" });
  await store.confirm(owner, id);
  await sql.query(`INSERT INTO operator_fee_records (action_id, action_kind, amount_base_units, token_asset_id, token_address, token_decimals, bps, recipient, collected_by, recorded_at)
    VALUES ($1, 'trade', $2::numeric, $3, $4, 6, 50, $5, 'in-batch-transfer', $6::timestamptz)`, [id, amountBaseUnits, OPERATOR_FEE_TOKEN.assetId, OPERATOR_FEE_TOKEN.address, recipient, recordedAt]);
  return id;
}

async function audits() {
  return (await sql.query<{ actor: string; action: string; target_kind: string; target_id: string; after: unknown }>(
    "SELECT actor, action, target_kind, target_id, after FROM admin_audit_log WHERE action = 'money.export' ORDER BY id")).rows;
}

async function bulkFees(count: number, at: string) {
  await sql.query(`WITH inserted AS (
    INSERT INTO actions (id, owner_key, provider, kind, summary, confirmed_at)
    SELECT gen_random_uuid(), 'bulk-' || g, 'base-account', 'trade', '{}'::jsonb, $2::timestamptz FROM generate_series(1, $1::int) g RETURNING id
  ) INSERT INTO operator_fee_records (action_id, action_kind, amount_base_units, token_asset_id, token_address, token_decimals, bps, recipient, collected_by, recorded_at)
    SELECT id, 'trade', 1000, $3, $4, 6, 50, $5, 'in-batch-transfer', $2::timestamptz FROM inserted`, [count, at, OPERATOR_FEE_TOKEN.assetId, OPERATOR_FEE_TOKEN.address, recipient]);
}

describePostgres("admin money movements and export", () => {
  beforeAll(async () => {
    client = new Bun.SQL(connectionString);
    await client.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.unsafe(`CREATE SCHEMA ${schema}`);
    await client.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await transaction.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(connectionString, { schema });
    store = new ActionsStore(sql);
  }, MIGRATION_BOOTSTRAP_TIMEOUT_MS);
  beforeEach(async () => { await sql.query("TRUNCATE actions CASCADE"); });
  afterAll(async () => {
    await sql?.dispose?.();
    await client?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client?.close();
  });

  test("each fee appears once across confirm replays, retries, reverts and unknown results, and succeeded rows match the overview total", async () => {
    const succeeded = await feeAction("9007199254740993", "2026-03-01T12:00:00Z");
    await store.confirm(owner, succeeded);
    await store.recordDecline(owner, succeeded, 0);
    await store.beginRetry(owner, succeeded, 1);
    await store.recordHandle(owner, succeeded, { transactionHash: `0x${"ab".repeat(32)}` });
    await store.recordOutcome(owner, succeeded, { outcome: "succeeded", source: "chain", settledAt: new Date("2026-03-04T00:00:00Z") });
    const reverted = await feeAction("300000", "2026-03-02T12:00:00Z");
    await store.recordHandle(owner, reverted, { transactionHash: `0x${"cd".repeat(32)}` });
    await store.recordOutcome(owner, reverted, { outcome: "reverted", source: "chain", settledAt: new Date("2026-03-04T00:00:00Z") });
    const declined = await feeAction("750000", "2026-03-03T12:00:00Z");
    await store.recordOutcome(owner, declined, { outcome: "not_submitted", source: "wallet", settledAt: null });
    const unknown = await feeAction("2500000", "2026-03-04T12:00:00Z");
    await store.recordHandle(owner, unknown, { providerHandle: `0x${"ef".repeat(32)}` });

    const movements = await listMoneyMovements(sql, { range: { from: null, to: null }, limit: 100 });
    expect<unknown>(movements.map(({ id, status, amountBaseUnits, transactionHash }) => ({ id, status, amountBaseUnits, transactionHash }))).toEqual([
      { id: `fee:${unknown}`, status: "unresolved", amountBaseUnits: "2500000", transactionHash: null },
      { id: `fee:${declined}`, status: "not_submitted", amountBaseUnits: "750000", transactionHash: null },
      { id: `fee:${reverted}`, status: "reverted", amountBaseUnits: "300000", transactionHash: `0x${"cd".repeat(32)}` },
      { id: `fee:${succeeded}`, status: "succeeded", amountBaseUnits: "9007199254740993", transactionHash: `0x${"ab".repeat(32)}` },
    ]);
    const customer = (await sql.query<{ customer_id: string }>("SELECT customer_id::text FROM actions WHERE id = $1", [succeeded])).rows[0]?.customer_id;
    expect(customer).toBeString();
    expect(new Set(movements.map((movement) => movement.customerId))).toEqual(new Set([customer ?? "missing"]));
    expect(movements.every((movement) => movement.payoutAddress === null && movement.category === "fee")).toBe(true);
    const succeededTotal = movements.filter((movement) => movement.status === "succeeded").reduce((sum, movement) => sum + BigInt(movement.amountBaseUnits), BigInt(0));
    expect(succeededTotal.toString()).toBe((await readOperatorRevenue(sql, { now: new Date("2026-03-05T00:00:00Z") })).collectedBaseUnits);
  });

  test("a date range exports only its UTC days, with one audit entry per export", async () => {
    await feeAction("1000000", "2026-03-01T23:59:59.999Z");
    await feeAction("2000000", "2026-03-02T00:00:00Z");
    await feeAction("3000000", "2026-03-03T00:00:00Z");
    const ranged = await handler(admin)(exportRequest({ version: 1, from: "2026-03-02", to: "2026-03-02" }));
    expect(ranged.status).toBe(200);
    expect(ranged.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(ranged.headers.get("content-disposition")).toBe("attachment; filename=\"home-money-movements-2026-03-02-to-2026-03-02.csv\"");
    expect(ranged.headers.get("cache-control")).toContain("no-store");
    const lines = (await ranged.text()).trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toStartWith("2026-03-02T00:00:00.000Z,fee,2,");
    const all = await handler(admin)(exportRequest({ version: 1, from: null, to: null }));
    expect((await all.text()).trim().split("\r\n").slice(1).map((line) => line.split(",")[2])).toEqual(["3", "2", "1"]);
    expect(await audits()).toEqual([
      { actor: admin, action: "money.export", target_kind: "money", target_id: "movements", after: { from: "2026-03-02", to: "2026-03-02", rows: 1 } },
      { actor: admin, action: "money.export", target_kind: "money", target_id: "movements", after: { from: null, to: null, rows: 3 } },
    ]);
  });

  test("pages walk every movement exactly once, including rows that share a timestamp", async () => {
    const ids = [
      await feeAction("1", "2026-03-01T12:00:00.000001Z"),
      await feeAction("2", "2026-03-01T12:00:00.000001Z"),
      await feeAction("3", "2026-03-01T12:00:00.000002Z"),
      await feeAction("4", "2026-03-01T12:00:00.000002Z"),
      await feeAction("5", "2026-03-01T11:00:00Z"),
    ];
    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 5; page++) {
      const result = await listMoneyMovements(sql, { range: { from: null, to: null }, limit: 2, before });
      seen.push(...result.rows.map((row) => row.id));
      before = result.next;
      if (!before) break;
    }
    expect(before).toBeNull();
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids.map((id) => `fee:${id}`)));
    expect(seen.at(-1)).toBe(`fee:${ids[4]}`);
  });

  test("an export larger than one batch returns every row in the range, with the rate on each fee", async () => {
    await bulkFees(50_001, "2026-03-05T00:00:00Z");
    await feeAction("7", "2026-03-04T00:00:00Z");
    const response = await handler(admin)(exportRequest({ version: 1, from: "2026-03-05", to: null }));
    expect(response.status).toBe(200);
    const lines = (await response.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("date,category,amount_usdc,rate_bps,customer_id,payout_address,transaction_hash,status");
    expect(lines).toHaveLength(50_002);
    expect(lines.slice(1).every((line) => line.startsWith("2026-03-05T00:00:00.000Z,fee,0.001,50,"))).toBe(true);
    expect((await audits()).at(-1)?.after).toEqual({ from: "2026-03-05", to: null, rows: 50_001 });
  }, 60_000);

  test("a payout signer or customer who is not an administrator cannot export and leaves no audit entry", async () => {
    await feeAction("1000000", "2026-03-01T12:00:00Z");
    const before = (await audits()).length;
    for (const address of [payoutSigner, owner.address]) {
      const response = await handler(address)(exportRequest({ version: 1, from: null, to: null }));
      expect(response.status).toBe(403);
      expect(parseAdminMoneyErrorResponse(await response.json())).toEqual({ error: { code: "OPERATOR_FORBIDDEN" } });
    }
    const invalid = await handler(admin)(exportRequest({ version: 1, from: "2026-03-02", to: "2026-03-01" }));
    expect(invalid.status).toBe(400);
    expect((await audits()).length).toBe(before);
  });
});
