import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { GROWTH_SETTINGS_DEFAULTS, type GrowthSettings } from "@/shared/operator-settings/growth";
import { requireAddress } from "@/shared/chain/hex";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import { snapshotInviteReward } from "./snapshot";
import { createRewardDecisionHandler } from "./admin-handlers";
import { readOperatorConfig } from "@/server/operator/config";
import { parseRewardDecisionResponse, parseGrowthAdminErrorResponse, type GrowthAdminErrorCode } from "@/shared/growth/admin-contract";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "growth_admin_handlers_test";
let admin: Bun.SQL;
let sql: SqlExecutor;
let migrations: string[];
const actor = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const attributedAt = new Date("2026-01-01T00:00:00Z");
const depositAt = new Date("2026-01-02T00:00:00Z");
const now = new Date("2026-01-04T00:00:00Z");
const vaultAddress = required(VERIFIED_SAVE_VAULTS[0]).address.toLowerCase();

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected growth decision fixture");
  return value;
}
const defaults: GrowthSettings = {
  ...GROWTH_SETTINGS_DEFAULTS, enabled: true, countries: ["US"], holdDays: 1,
  inviterRewardAtoms: "1000000", minDepositAtoms: "25000000", budgetAtoms: "1000000000", perInviterCap: 100,
  termsText: "Keep the qualifying deposit in Save for one day.", payoutAccount: requireAddress(actor),
  acknowledgements: { taxReporting: true, sanctionsScreening: true },
};

async function settings(overrides: Partial<GrowthSettings> = {}) {
  await sql.query(`INSERT INTO operator_settings(domain,schema_version,value,revision,updated_at,updated_by)
    VALUES ('growth',1,$1::jsonb,1,$2,$3) ON CONFLICT(domain) DO UPDATE SET value=EXCLUDED.value`,
  [JSON.stringify({ ...defaults, ...overrides }), now, actor]);
}
async function customer(country: string | null = "US") {
  const id = randomUUID();
  await sql.query("INSERT INTO customers(id,country,first_seen_at,last_seen_at,first_seen_source) VALUES ($1,$2,$3,$3,'sign_in')", [id, country, attributedAt]);
  return id;
}
async function reward(inviter = "", country: string | null = "US") {
  const inviterId = inviter || await customer();
  const inviteeId = await customer(country);
  const result = await snapshotInviteReward(sql, { inviteeCustomerId: inviteeId, inviterCustomerId: inviterId, inviteCode: "abcdefghjk", country, at: attributedAt });
  if (result.kind !== "created") throw new Error(`Expected snapshot, got ${result.reason}`);
  const id = required((await sql.query<{ id: string }>("SELECT id FROM invite_rewards WHERE invitee_customer_id=$1", [inviteeId])).rows[0]).id;
  return { id, inviterId, inviteeId };
}
async function evidence(inviteeId: string, options: { history?: boolean; dip?: boolean; behind?: boolean } = {}) {
  const credentialId = randomUUID();
  const walletId = randomUUID();
  const address = `0x${randomUUID().replaceAll("-", "").padStart(40, "0")}`;
  const actionId = randomUUID();
  const hash = `0x${randomUUID().replaceAll("-", "").repeat(2)}`;
  await sql.query(`INSERT INTO customer_credentials(id,customer_id,account_provider,subject,first_seen_at,last_seen_at)
    VALUES ($1,$2,'base-account',$3,$4,$4)`, [credentialId, inviteeId, address, attributedAt]);
  await sql.query("INSERT INTO customer_wallets(id,customer_id,credential_id,chain_id,address) VALUES ($1,$2,$3,$4,$5)", [walletId, inviteeId, credentialId, BASE_CHAIN_ID, address]);
  const summary = {
    amounts: [{ assetId: `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC_ADDRESS.toLowerCase()}`, direction: "spend", amountBaseUnits: "25000000" }],
    metadata: { product: "savings", operation: "deposit", vaultAddress, network: { chainId: BASE_CHAIN_ID } },
  };
  await sql.query(`INSERT INTO actions(id,owner_key,provider,kind,summary,customer_id,credential_id,wallet_id,account_address,
    confirmed_at,transaction_hash,outcome,outcome_source,settled_at,outcome_recorded_at,observed_receipt_transaction_hash,observed_receipt_block_number)
    VALUES ($1,$2,'base-account','savings-deposit',$3::jsonb,$4,$5,$6,$7,$8,$9,'succeeded','chain',$8,$8,$9,10)`,
  [actionId, JSON.stringify([address, address]), JSON.stringify(summary), inviteeId, credentialId, walletId, address, depositAt, hash]);
  if (options.history === false) return { actionId, hash, address, historyId: null, assetId: null };
  const historyId = required((await sql.query<{ id: number }>(`INSERT INTO history_addresses(chain_id,address,window_start_block,window_start_at,enrolled_block,backfill_block,forward_block,ingested_at)
    VALUES ($1,$2,1,$3,1,1,1000,$4) RETURNING id`, [BASE_CHAIN_ID, address, attributedAt, options.behind ? depositAt : now])).rows[0]).id;
  const assetId = required((await sql.query<{ id: number }>(`INSERT INTO history_assets(chain_id,asset_key,kind,contract_address,decimals)
    VALUES ($1,$2,'vault-share',$3,18) ON CONFLICT(chain_id,asset_key) DO UPDATE SET kind=EXCLUDED.kind RETURNING id`,
  [BASE_CHAIN_ID, `vault:${vaultAddress}`, vaultAddress])).rows[0]).id;
  await sql.query("INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,observed_at) VALUES ($1,$2,1,'window-start',0,$3)", [historyId, assetId, attributedAt]);
  await sql.query(`INSERT INTO balance_changes(address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source)
    VALUES ($1,$2,10,0,$3,decode($4,'hex'),100,'cdp-sql-transfer')`, [historyId, assetId, depositAt, hash.slice(2)]);
  await sql.query(`INSERT INTO chain_buckets(chain_id,bucket_at,block_number,block_hash,block_time)
    VALUES ($1,$2,1000,decode($3,'hex'),$2) ON CONFLICT DO NOTHING`, [BASE_CHAIN_ID, now, "11".repeat(32)]);
  if (options.dip) await dip(historyId, assetId);
  return { actionId, hash, address, historyId, assetId };
}
async function dip(historyId: number, assetId: number) {
  await sql.query(`INSERT INTO balance_changes(address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source)
    VALUES ($1,$2,20,0,'2026-01-02T12:00:00Z',decode($3,'hex'),-1,'cdp-sql-transfer')`, [historyId, assetId, "22".repeat(32)]);
}
async function qualified(inviter = "") {
  const row = await reward(inviter);
  const ledger = await evidence(row.inviteeId);
  await sql.query(`UPDATE invite_rewards SET state='qualified',deposit_action_id=$2,deposit_tx_hash=$3,deposit_block_number=10,
    deposit_at=$4,deposit_assets_atoms=25000000,deposit_shares_atoms=100,min_shares_atoms=100,
    window_ends_at='2026-01-03T00:00:00Z',qualified_at='2026-01-03T00:00:00Z' WHERE id=$1`, [row.id, ledger.actionId, ledger.hash, depositAt]);
  return { ...row, ...ledger };
}
const handler = createRewardDecisionHandler({
  authorize: async () => ({ user: { subject: "growth-admin-handler-test" }, accountProvider: "base-account",
    smartAccount: { address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chainId: BASE_CHAIN_ID } }),
  config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: actor }),
  sql: () => sql,
});
async function decide(id: string, action: "approve" | "reject" = "approve", reason = "Manual review") {
  return handler(new Request(`https://home.test/api/admin/growth/rewards/${id}`, {
    method: "POST", headers: { origin: "https://home.test", "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ version: 1, action, ...(action === "reject" ? { reason } : {}) }),
  }), { params: Promise.resolve({ id }) });
}
async function expectError(response: Response, status: number, code: GrowthAdminErrorCode) {
  expect(response.status).toBe(status);
  expect(parseGrowthAdminErrorResponse(await response.json())).toEqual({ error: { code } });
  expect(response.headers.get("cache-control")).toContain("private, no-store");
}

describePostgres("growth decision HTTP contract with real PostgreSQL", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("ACTION_PG_TEST_URL is required");
    admin = new Bun.SQL(connectionString);
    migrations = await readAllMigrationSql();
    sql = createPostgresSqlExecutor(connectionString, { schema });
  });
  beforeEach(async () => {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of migrations) await tx.unsafe(migration);
    });
    await settings();
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test.each(["approve", "reject"] as const)("%s returns a parsed response and commits its authenticated audit", async (action) => {
    const row = await qualified();
    const response = await decide(row.id, action);
    expect(response.status).toBe(200);
    const state = action === "approve" ? "approved" : "rejected";
    expect(parseRewardDecisionResponse(await response.json())).toEqual({ version: 1, state });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const stored = (await sql.query("SELECT state,decided_by,reserved_atoms,decision_reason FROM invite_rewards WHERE id=$1", [row.id])).rows[0];
    expect(stored).toEqual({ state, decided_by: actor, reserved_atoms: action === "approve" ? "1000000" : null, decision_reason: action === "reject" ? "Manual review" : null });
    const audits = (await sql.query("SELECT actor,action,target_id,after FROM admin_audit_log WHERE target_kind='reward'")).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor, action: `growth.reward.${action}`, target_id: row.id, after: { state, riskSignals: [] } });
    await expectError(await decide(row.id), 409, "NOT_QUALIFIED");
  });

  test("missing and nonqualified rewards have distinct errors", async () => {
    await expectError(await decide(randomUUID()), 404, "NOT_FOUND");
    await expectError(await decide((await reward()).id), 409, "NOT_QUALIFIED");
  });

  test("a proven balance drop revalidates to a typed conflict without an approval audit", async () => {
    const row = await qualified();
    await dip(required(row.historyId), required(row.assetId));
    await expectError(await decide(row.id), 409, "NO_LONGER_QUALIFIES");
    expect((await sql.query("SELECT state FROM invite_rewards WHERE id=$1", [row.id])).rows[0]).toEqual({ state: "disqualified" });
    expect((await sql.query("SELECT id FROM admin_audit_log WHERE target_kind='reward'")).rows).toEqual([]);
  });

  test("incomplete history returns a typed conflict and leaves the state unchanged", async () => {
    const row = await qualified();
    await sql.query("UPDATE history_addresses SET ingested_at=$2 WHERE id=$1", [row.historyId, depositAt]);
    await expectError(await decide(row.id), 409, "HISTORY_PENDING");
    expect((await sql.query("SELECT state FROM invite_rewards WHERE id=$1", [row.id])).rows[0]).toEqual({ state: "qualified" });
  });

  for (const constraint of ["cap", "budget"] as const) {
    test(`${constraint} exhaustion maps the database guard to a typed conflict`, async () => {
      await settings(constraint === "cap" ? { perInviterCap: 1 } : { budgetAtoms: "1000000" });
      const first = await qualified();
      const second = await qualified(constraint === "cap" ? first.inviterId : "");
      expect((await decide(first.id)).status).toBe(200);
      await expectError(await decide(second.id), 409, constraint === "cap" ? "CAP_REACHED" : "BUDGET_EXHAUSTED");
      expect((await sql.query("SELECT id FROM admin_audit_log WHERE target_kind='reward'")).rows).toHaveLength(1);
    });
  }

  test("missing settings blocks approval with a typed conflict", async () => {
    const row = await qualified();
    await sql.query("DELETE FROM operator_settings WHERE domain='growth'");
    await expectError(await decide(row.id), 409, "SETTINGS_MISSING");
  });

  test("rejection reasons reject ill-formed Unicode at the HTTP boundary but preserve emoji", async () => {
    const row = await qualified();
    for (const reason of [" ", "x".repeat(201), "Review\ud800", "\udc00Review", "Review\ud800x\udc00"]) {
      await expectError(await decide(row.id, "reject", reason), 400, "INVALID_REQUEST");
    }
    expect((await sql.query("SELECT state FROM invite_rewards WHERE id=$1", [row.id])).rows[0]).toEqual({ state: "qualified" });
    expect((await sql.query("SELECT id FROM admin_audit_log WHERE target_kind='reward'")).rows).toEqual([]);
    const response = await decide(row.id, "reject", "Manual review 😀");
    expect(response.status).toBe(200);
    expect(parseRewardDecisionResponse(await response.json())).toEqual({ version: 1, state: "rejected" });
    expect((await sql.query("SELECT decision_reason FROM invite_rewards WHERE id=$1", [row.id])).rows[0])
      .toEqual({ decision_reason: "Manual review 😀" });
  });
});
