import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { CustomerResolver } from "@/server/customers/resolve";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { GROWTH_SETTINGS_DEFAULTS, type GrowthSettings } from "@/shared/operator-settings/growth";
import { requireAddress } from "@/shared/chain/hex";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import { snapshotInviteReward } from "./snapshot";
import { approveReward, listRewardQueue, refreshInviteRewards, rejectReward } from "./queue";
import { evaluateReward, type RewardRow } from "./qualification";
import { readProgramFunnel } from "./funnel";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "growth_queue_contract_test";
let admin: Bun.SQL;
let sql: SqlExecutor;
let migrations: string[];
const actor = "0x1111111111111111111111111111111111111111";
const attributedAt = new Date("2026-01-01T00:00:00Z");
const depositAt = new Date("2026-01-02T00:00:00Z");
const now = new Date("2026-01-04T00:00:00Z");
const vaultAddress = required(VERIFIED_SAVE_VAULTS[0]).address.toLowerCase();

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected growth queue fixture");
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
async function stored(id: string) {
  return required((await sql.query("SELECT * FROM invite_rewards WHERE id=$1", [id])).rows[0]);
}
async function audits() {
  return (await sql.query("SELECT action,target_kind,target_id,before,after FROM admin_audit_log WHERE target_kind='reward' ORDER BY id")).rows;
}

describePostgres("invite reward snapshot and operator decisions", () => {
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
    setObservabilityLogWriterForTests();
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("active terms are immutable and attribution is idempotent", async () => {
    const row = await reward();
    await settings({ inviterRewardAtoms: "2000000", holdDays: 2 });
    expect(await snapshotInviteReward(sql, { inviteeCustomerId: row.inviteeId, inviterCustomerId: row.inviterId,
      inviteCode: "abcdefghjk", country: "US", at: now })).toEqual({ kind: "skipped", reason: "already-snapshotted" });
    expect((await stored(row.id)).terms).toEqual({ inviterRewardAtoms: "1000000", minDepositAtoms: "25000000", holdDays: 1, countries: ["US"], termsText: defaults.termsText });
    await expect(sql.query("UPDATE invite_rewards SET terms='{}'::jsonb WHERE id=$1", [row.id])).rejects.toThrow();
  });

  test.each([
    [false, null, null, "program-inactive"], [true, "2026-01-01T00:00:01Z", null, "program-inactive"],
    [true, null, "2026-01-01T00:00:00Z", "program-inactive"],
  ] as const)("inactive snapshot enabled=%s starts=%s ends=%s writes nothing", async (enabled, startsAt, endsAt, reason) => {
    await settings({ enabled, startsAt, endsAt });
    expect(await snapshotInviteReward(sql, { inviteeCustomerId: await customer(), inviterCustomerId: await customer(), inviteCode: "abcdefghjk", country: "US", at: attributedAt })).toEqual({ kind: "skipped", reason });
    expect((await sql.query("SELECT id FROM invite_rewards")).rows).toEqual([]);
  });

  test("the start instant is inclusive and end is exclusive", async () => {
    await settings({ startsAt: attributedAt.toISOString(), endsAt: "2026-01-02T00:00:00Z" });
    expect((await reward()).id).toBeDefined();
  });

  test.each([[null, "country-unknown"], ["CA", "country-not-offered"]] as const)("country %s is terminally ineligible", async (country, reason) => {
    const row = await reward("", country);
    expect(await stored(row.id)).toMatchObject({ state: "ineligible", reason });
    await expect(sql.query("UPDATE invite_rewards SET state='joined',reason=NULL WHERE id=$1", [row.id])).rejects.toThrow();
  });

  test("missing, invalid and database-less settings fail closed without throwing", async () => {
    const input = { inviteeCustomerId: await customer(), inviterCustomerId: await customer(), inviteCode: "abcdefghjk", country: "US", at: attributedAt };
    expect(await snapshotInviteReward(null, input)).toEqual({ kind: "skipped", reason: "database-unavailable" });
    await sql.query("DELETE FROM operator_settings WHERE domain='growth'");
    expect(await snapshotInviteReward(sql, input)).toEqual({ kind: "skipped", reason: "settings-missing" });
    await settings();
    await sql.query("UPDATE operator_settings SET value='{}'::jsonb WHERE domain='growth'");
    expect(await snapshotInviteReward(sql, input)).toEqual({ kind: "skipped", reason: "settings-invalid" });
  });

  test("sign-in snapshots inside attribution transaction and repeat sign-in never resnapshots", async () => {
    const inviterId = await customer();
    await sql.query("INSERT INTO invite_codes(code,customer_id) VALUES ('abcdefghjk',$1)", [inviterId]);
    const session = { accountProvider: "base-account" as const, user: { subject: randomUUID() }, smartAccount: null };
    const resolver = new CustomerResolver(sql);
    const created = await resolver.resolveCustomer(session, { create: true, country: "US", inviteCode: "abcdefghjk", at: attributedAt });
    await settings({ inviterRewardAtoms: "2000000" });
    await resolver.resolveCustomer(session, { create: true, country: "CA", inviteCode: "abcdefghjk", at: now });
    const rows = (await sql.query("SELECT inviter_customer_id,terms FROM invite_rewards WHERE invitee_customer_id=$1", [created.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inviter_customer_id: inviterId, terms: { inviterRewardAtoms: "1000000" } });
    expect((await sql.query("SELECT name FROM operator_events WHERE customer_id=$1 AND name='invite.attributed'", [created.id])).rowCount).toBe(1);
  });

  test("real ledger refresh anchors, disqualifies dips, qualifies elapsed windows, and keeps missing history pending", async () => {
    const healthy = await reward();
    const dropped = await reward();
    const missing = await reward();
    const noDeposit = await reward();
    await evidence(healthy.inviteeId);
    await evidence(dropped.inviteeId, { dip: true });
    await evidence(missing.inviteeId, { history: false });
    expect(await refreshInviteRewards(sql, { now })).toEqual({ evaluated: 4, updated: 4, failed: 0 });
    expect(await stored(healthy.id)).toMatchObject({ state: "saved", deposit_assets_atoms: "25000000", deposit_shares_atoms: "100" });
    expect(await stored(missing.id)).toMatchObject({ state: "joined", history_pending: "history-unavailable" });
    expect(await stored(noDeposit.id)).toMatchObject({ state: "joined", history_pending: null });
    expect(await refreshInviteRewards(sql, { now })).toEqual({ evaluated: 4, updated: 4, failed: 0 });
    expect(await stored(healthy.id)).toMatchObject({ state: "qualified", qualified_at: new Date("2026-01-03T00:00:00Z") });
    expect(await stored(dropped.id)).toMatchObject({ state: "disqualified", reason: "balance-dropped", min_shares_atoms: "99" });
    await expect(sql.query("UPDATE invite_rewards SET state='saved',reason=NULL WHERE id=$1", [dropped.id])).rejects.toThrow();
    const funnel = await readProgramFunnel(sql);
    expect(funnel).toMatchObject({ counts: { joined: 2, qualified: 1, disqualified: 1 }, historyPendingCount: 1, reservedAtoms: "0", approvedCount: 0 });
  });

  test("concurrent refreshes cannot overwrite each other's state transitions", async () => {
    const row = await reward();
    await evidence(row.inviteeId);
    await Promise.all(Array.from({ length: 8 }, () => refreshInviteRewards(sql, { now })));
    expect(["saved", "qualified"]).toContain(String((await stored(row.id)).state));
    await refreshInviteRewards(sql, { now });
    expect((await stored(row.id)).state).toBe("qualified");
  });

  test("a failing row is isolated and raw errors are never logged", async () => {
    const bad = await reward();
    const good = await reward();
    await evidence(good.inviteeId);
    const logs: string[] = [];
    setObservabilityLogWriterForTests((line) => { logs.push(line); });
    const failing: SqlExecutor = {
      transaction: (fn) => sql.transaction(fn),
      query: (text, values, options) => {
        if (text.includes("FROM actions") && values?.[0] === bad.inviteeId) throw new Error("private raw provider payload");
        return sql.query(text, values, options);
      },
    };
    expect(await refreshInviteRewards(failing, { now })).toEqual({ evaluated: 2, updated: 1, failed: 1 });
    expect((await stored(bad.id)).evaluated_at).toBeNull();
    expect((await stored(good.id)).state).toBe("saved");
    expect(logs.join(" ")).toContain("GROWTH_REWARD_REFRESH_FAILED");
    expect(logs.join(" ")).not.toContain("private raw provider payload");
    setObservabilityLogWriterForTests();
  });

  test("approval uses snapshotted amount even after program disablement and writes one atomic audit", async () => {
    const row = await qualified();
    await settings({ enabled: false, endsAt: "2026-01-02T00:00:00Z", inviterRewardAtoms: "9000000" });
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: true, state: "approved" });
    expect(await stored(row.id)).toMatchObject({ state: "approved", reserved_atoms: "1000000", decided_at: now, decided_by: actor });
    expect(await audits()).toEqual([{ action: "growth.reward.approve", target_kind: "reward", target_id: row.id,
      before: { state: "qualified" }, after: { state: "approved", reservedAtoms: "1000000", riskSignals: [] } }]);
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "not-qualified" });
    await expect(sql.query("UPDATE invite_rewards SET state='qualified',reserved_atoms=NULL,decided_at=NULL,decided_by=NULL WHERE id=$1", [row.id])).rejects.toThrow();
    expect(await readProgramFunnel(sql)).toMatchObject({ approvedCount: 1, reservedAtoms: "1000000" });
  });

  test("approval revalidation disqualifies a proven dip and refuses incomplete history", async () => {
    const dropped = await qualified();
    await dip(required(dropped.historyId), required(dropped.assetId));
    expect(await approveReward(sql, { rewardId: dropped.id, actor, now })).toEqual({ ok: false, error: "no-longer-qualifies" });
    expect(await stored(dropped.id)).toMatchObject({ state: "disqualified", reason: "balance-dropped", qualified_at: null });
    const pending = await qualified();
    await sql.query("UPDATE history_addresses SET ingested_at=$2 WHERE id=$1", [pending.historyId, depositAt]);
    const before = await stored(pending.id);
    expect(await approveReward(sql, { rewardId: pending.id, actor, now })).toEqual({ ok: false, error: "history-pending" });
    expect(await stored(pending.id)).toEqual(before);
    expect(await audits()).toEqual([]);
  });

  test("a replay-invalidated reconcile mismatch keeps evaluation and approval pending until recomparison", async () => {
    const row = await qualified();
    const evaluationRow: RewardRow = { id: row.id, inviterCustomerId: row.inviterId, inviteeCustomerId: row.inviteeId,
      terms: defaults, attributedAt, state: "qualified", depositActionId: row.actionId, depositTxHash: row.hash,
      depositAt, depositSharesAtoms: BigInt(100), windowEndsAt: new Date("2026-01-03T00:00:00Z") };
    await sql.query(`INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,log_quantity,observed_at)
      VALUES ($1,$2,20,'reconcile',0,10,$3)`, [row.historyId, row.assetId, now]);
    const before = await stored(row.id);
    expect(await evaluateReward(sql, evaluationRow, now)).toEqual({ kind: "pending", reason: "history-unavailable" });
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "history-pending" });
    await sql.query(`UPDATE balance_checkpoints SET log_quantity=NULL
      WHERE address_id=$1 AND asset_id=$2 AND purpose='reconcile'`, [row.historyId, row.assetId]);
    expect(await evaluateReward(sql, evaluationRow, now)).toEqual({ kind: "pending", reason: "history-unavailable" });
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "history-pending" });
    expect(await stored(row.id)).toEqual(before);
    expect((await stored(row.id)).reserved_atoms).toBeNull();
    expect(await audits()).toEqual([]);
    await sql.query(`UPDATE balance_checkpoints SET chain_quantity=100,log_quantity=100
      WHERE address_id=$1 AND asset_id=$2 AND purpose='reconcile'`, [row.historyId, row.assetId]);
    expect((await evaluateReward(sql, evaluationRow, now)).kind).toBe("qualified");
  });

  test.each([
    { enabled: true }, { perInviterCap: 1 }, { budgetAtoms: "1000000" },
    { perInviterCap: "invalid", budgetAtoms: "1000000" }, { perInviterCap: 1, budgetAtoms: "invalid" },
    { perInviterCap: 1, budgetAtoms: "NaN" }, { perInviterCap: 1, budgetAtoms: "Infinity" },
  ])("malformed reservation settings fail closed in approval and the database guard: %j", async (value) => {
    const row = await qualified();
    await sql.query("UPDATE operator_settings SET value=$1::jsonb WHERE domain='growth'", [JSON.stringify(value)]);
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "settings-missing" });
    await expect(sql.query(`UPDATE invite_rewards SET state='approved',reserved_atoms=1000000,decided_at=$2,decided_by=$3 WHERE id=$1`,
      [row.id, now, actor])).rejects.toMatchObject({ code: "23514", constraint: "invite_rewards_settings" });
    expect(await stored(row.id)).toMatchObject({ state: "qualified", reserved_atoms: null });
    expect(await audits()).toEqual([]);
  });

  test.each(["approved", "rejected", "disqualified", "ineligible"] as const)("%s final rewards cannot rewrite reservation, decision or qualification evidence", async (state) => {
    const row = state === "ineligible" ? await reward("", "CA") : await qualified();
    if (state === "approved") expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: true, state });
    if (state === "rejected") expect(await rejectReward(sql, { rewardId: row.id, actor, now, reason: "Review" })).toEqual({ ok: true, state });
    if (state === "disqualified") {
      await sql.query(`INSERT INTO balance_changes(address_id,asset_id,block_number,log_index,block_time,delta,source)
        SELECT h.id,a.id,20,0,'2026-01-02T12:00:00Z',-1,'cdp-sql-transfer' FROM customer_wallets w
        JOIN history_addresses h ON h.chain_id=w.chain_id AND h.address=w.address
        JOIN history_assets a ON a.contract_address=$2 WHERE w.customer_id=$1`, [row.inviteeId, vaultAddress]);
      expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "no-longer-qualifies" });
    }
    const before = await stored(row.id);
    const assignments = [
      "reserved_atoms=COALESCE(reserved_atoms,0)+1",
      "decided_at=COALESCE(decided_at,attributed_at)+interval '1 second'",
      "decided_by='0x2222222222222222222222222222222222222222'", "decision_reason='Changed'",
      `risk_signals='["funded-by-inviter"]'::jsonb`,
      `deposit_action_id=${state === "ineligible" ? "'00000000-0000-4000-8000-000000000001'::uuid" : "NULL"}`,
      `deposit_tx_hash='0x${"ee".repeat(32)}'`, "deposit_block_number=COALESCE(deposit_block_number,0)+1",
      "deposit_at=COALESCE(deposit_at,attributed_at)+interval '1 second'",
      "deposit_assets_atoms=COALESCE(deposit_assets_atoms,0)+1", "deposit_shares_atoms=COALESCE(deposit_shares_atoms,0)+1",
      "qualified_at=COALESCE(qualified_at,attributed_at)+interval '1 second'",
      "min_shares_atoms=COALESCE(min_shares_atoms,0)+1",
      "window_ends_at=COALESCE(window_ends_at,attributed_at)+interval '1 second'",
      "invite_code='changed-code'", `reason=${state === "disqualified" ? "NULL" : "'balance-dropped'"}`,
      "history_pending='history-unavailable'",
    ];
    for (const assignment of assignments) await expect(sql.query(`UPDATE invite_rewards SET ${assignment} WHERE id=$1`, [row.id]))
      .rejects.toThrow(`invite reward state ${state} is final`);
    expect(await stored(row.id)).toEqual(before);
    await sql.query("UPDATE invite_rewards SET risk_signals=risk_signals WHERE id=$1", [row.id]);
    await sql.query("UPDATE invite_rewards SET evaluated_at=$2 WHERE id=$1", [row.id, now]);
    expect((await stored(row.id)).evaluated_at).toEqual(now);
  });

  test("unparseable or missing current settings cannot reserve or audit", async () => {
    const row = await qualified();
    await sql.query("UPDATE operator_settings SET value='{}'::jsonb WHERE domain='growth'");
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "settings-missing" });
    await sql.query("DELETE FROM operator_settings WHERE domain='growth'");
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "settings-missing" });
    expect((await stored(row.id)).state).toBe("qualified");
    expect(await audits()).toEqual([]);
  });

  test("rejection requires a private reason and does not reserve funds", async () => {
    const row = await qualified();
    for (const reason of ["", " ", "x".repeat(201), "Review\u0000reason", "Review\u0001reason", "Review\u001freason", "Review\u007freason", "Review\u0085reason", "\tReview", "Review\n",
      "Review\ud800", "\udc00Review", "Review\ud800x\udc00"]) expect(await rejectReward(sql, { rewardId: row.id, actor, now, reason })).toEqual({ ok: false, error: "invalid-reason" });
    expect(await rejectReward(sql, { rewardId: row.id, actor, now, reason: " Manual review 😀 " })).toEqual({ ok: true, state: "rejected" });
    expect(await stored(row.id)).toMatchObject({ state: "rejected", reserved_atoms: null, decision_reason: "Manual review 😀" });
    expect(await audits()).toEqual([{ action: "growth.reward.reject", target_kind: "reward", target_id: row.id,
      before: { state: "qualified" }, after: { state: "rejected", reason: "Manual review 😀", riskSignals: [] } }]);
    await expect(sql.query("UPDATE invite_rewards SET state='qualified',decided_at=NULL,decided_by=NULL WHERE id=$1", [row.id])).rejects.toThrow();
  });

  test("decision validation rejects noncanonical actors, absent rows and nonqualified rows", async () => {
    const row = await reward();
    expect(await approveReward(sql, { rewardId: row.id, actor: "0x" + "AA".repeat(20), now })).toEqual({ ok: false, error: "invalid-actor" });
    expect(await approveReward(sql, { rewardId: randomUUID(), actor, now })).toEqual({ ok: false, error: "not-found" });
    expect(await approveReward(sql, { rewardId: row.id, actor, now })).toEqual({ ok: false, error: "not-qualified" });
    expect(await rejectReward(sql, { rewardId: row.id, actor, now, reason: "Review" })).toEqual({ ok: false, error: "not-qualified" });
  });

  for (const guard of ["cap", "budget"] as const) {
    test(`concurrent approvals serialize against the current ${guard} and audit exactly one success`, async () => {
      await settings(guard === "cap" ? { perInviterCap: 1 } : { budgetAtoms: "1000000" });
      const inviter = await customer();
      const rows = [];
      for (let index = 0; index < 8; index++) rows.push(await qualified(guard === "cap" ? inviter : ""));
      const results = await Promise.all(rows.map((row) => approveReward(sql, { rewardId: row.id, actor, now })));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual(Array.from({ length: 7 }, () => ({ ok: false, error: guard === "cap" ? "cap-reached" : "budget-exhausted" })));
      const approved = (await sql.query<{ id: string }>("SELECT id FROM invite_rewards WHERE state='approved'")).rows;
      expect(approved).toHaveLength(1);
      expect(await audits()).toHaveLength(1);
      expect(required((await audits())[0]).target_id).toBe(required(approved[0]).id);
    });
  }

  test("a racing approve and reject produce one terminal decision and one audit", async () => {
    const row = await qualified();
    const results = await Promise.all([
      approveReward(sql, { rewardId: row.id, actor, now }), rejectReward(sql, { rewardId: row.id, actor, now, reason: "Review" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "not-qualified" }]);
    expect(await audits()).toHaveLength(1);
  });

  test("audit failure rolls back the decision and reservation", async () => {
    const row = await qualified();
    await sql.query(`CREATE FUNCTION fail_growth_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
    await sql.query("CREATE TRIGGER fail_growth_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_growth_audit()");
    await expect(approveReward(sql, { rewardId: row.id, actor, now })).rejects.toThrow("audit unavailable");
    expect(await stored(row.id)).toMatchObject({ state: "qualified", reserved_atoms: null });
    expect(await audits()).toEqual([]);
  });

  test("queue lists oldest qualification first, recomputes risk and exposes only short customer ids", async () => {
    const old = await qualified();
    const recent = await qualified();
    await sql.query("UPDATE invite_rewards SET qualified_at=qualified_at+interval '1 hour' WHERE id=$1", [recent.id]);
    await sql.query("UPDATE invite_rewards SET risk_signals='[\"funded-by-inviter\"]'::jsonb WHERE id=$1", [old.id]);
    const queue = await listRewardQueue(sql, { now });
    expect(queue.qualified.map((row) => row.id)).toEqual([old.id, recent.id]);
    expect(queue.qualified[0]).toMatchObject({ inviterShortId: old.inviterId.slice(0, 8), inviteeShortId: old.inviteeId.slice(0, 8),
      depositAssetsAtoms: "25000000", attributedAt: attributedAt.toISOString(), qualifiedAt: "2026-01-03T00:00:00.000Z", riskSignals: [] });
    const output = JSON.stringify(queue);
    for (const privateValue of [old.inviterId, old.inviteeId, old.address]) expect(output).not.toContain(privateValue);
    await approveReward(sql, { rewardId: old.id, actor, now });
    const approved = await listRewardQueue(sql, { now, limit: 1 });
    expect(approved.approved).toHaveLength(1);
    expect(approved.approved[0]).toMatchObject({ id: old.id, reservedAtoms: "1000000", decidedAt: now.toISOString() });
    expect(approved.approvedAtoms).toBe("1000000");
  });

  test("deleting either customer cascades reward rows", async () => {
    const invitee = await reward();
    const inviter = await reward();
    await sql.query("DELETE FROM customers WHERE id=$1", [invitee.inviteeId]);
    await sql.query("DELETE FROM customers WHERE id=$1", [inviter.inviterId]);
    expect((await sql.query("SELECT id FROM invite_rewards")).rows).toEqual([]);
  });
});
