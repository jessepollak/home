import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readAllMigrationSql } from "@/tests/helpers/migrations";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, VERIFIED_SAVE_VAULTS } from "@/shared/savings/config";
import type { InviteRewardTerms } from "@/shared/growth/reward";
import { evaluateReward, type RewardRow } from "./qualification";
import { computeRiskSignals } from "./risk";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "growth_qualification_test";
let admin: Bun.SQL;
let sql: SqlExecutor;
let row: RewardRow;
let inviteeHistory: number;
let inviterHistory: number;
let otherHistory: number;
let vaultAsset: number;
let usdcAsset: number;
const hash = `0x${"ab".repeat(32)}`;
const start = new Date("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(start.getTime() + days * 86_400_000);
const terms: InviteRewardTerms = { minDepositAtoms: "100", inviterRewardAtoms: "10", holdDays: 30, countries: ["US"], termsText: "Terms" };
const vault = required(VERIFIED_SAVE_VAULTS[0]).address.toLowerCase();

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected growth qualification fixture");
  return value;
}

async function customer(addressDigit: string) {
  const customerId = randomUUID();
  const credentialId = randomUUID();
  const address = `0x${addressDigit.repeat(40)}`;
  await sql.query(`INSERT INTO customers (id, first_seen_at, last_seen_at, first_seen_source) VALUES ($1,$2,$2,'sign_in')`, [customerId, at(-10)]);
  await sql.query(`INSERT INTO customer_credentials (id, customer_id, account_provider, subject, first_seen_at, last_seen_at)
    VALUES ($1,$2,'base-account',$3,$4,$4)`, [credentialId, customerId, customerId, at(-10)]);
  await sql.query(`INSERT INTO customer_wallets (id, customer_id, credential_id, chain_id, address) VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), customerId, credentialId, BASE_CHAIN_ID, address]);
  const history = await sql.query<{ id: number }>(`INSERT INTO history_addresses
    (chain_id,address,window_start_block,window_start_at,enrolled_block,backfill_block,forward_block,ingested_at)
    VALUES ($1,$2,1,$3,2,1,100,$4) RETURNING id`, [BASE_CHAIN_ID, address, at(-10), at(60)]);
  return { customerId, historyId: required(history.rows[0]).id };
}
async function addChange(addressId: number, assetId: number, delta: string, day: number, block = 10 + day, log = 1) {
  await sql.query(`INSERT INTO balance_changes (address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source)
    VALUES ($1,$2,$3,$4,$5,NULL,$6,'cdp-sql-transfer')`,
    [addressId, assetId, block, log, at(day), delta]);
  if (assetId === vaultAsset) await reconcile(addressId, assetId);
}
async function reconcile(addressId: number, assetId: number) {
  await sql.query(`INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,log_quantity,observed_at)
    SELECT $1,$2,100,'reconcile',COALESCE(sum(delta),0),COALESCE(sum(delta),0),$3
    FROM balance_changes WHERE address_id=$1 AND asset_id=$2 AND block_number>1 AND block_number<=100
    ON CONFLICT(address_id,asset_id,block_number) DO UPDATE SET chain_quantity=EXCLUDED.chain_quantity,log_quantity=EXCLUDED.log_quantity`,
  [addressId, assetId, at(60)]);
}
async function seedMixedHashDip() {
  const otherHash = "cd".repeat(32);
  await sql.query("DELETE FROM balance_changes WHERE address_id=$1 AND asset_id=$2", [inviteeHistory, vaultAsset]);
  await sql.query(`INSERT INTO balance_changes (address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source)
    VALUES ($1,$2,10,1,$3,decode($4,'hex'),10,'cdp-sql-transfer'),
      ($1,$2,10,2,$3,decode($5,'hex'),-10,'cdp-sql-transfer'),
      ($1,$2,10,3,$3,decode($5,'hex'),20,'cdp-sql-transfer')`,
  [inviteeHistory, vaultAsset, start, hash.slice(2), otherHash]);
  await reconcile(inviteeHistory, vaultAsset);
}
async function seedReward(inviteeCustomerId: string, inviterCustomerId: string, attributedAt = at(-1)) {
  await sql.query(`INSERT INTO invite_rewards (id,invitee_customer_id,inviter_customer_id,invite_code,terms,attributed_at)
    VALUES ($1,$2,$3,'code',$4::jsonb,$5)`, [randomUUID(), inviteeCustomerId, inviterCustomerId, JSON.stringify(terms), attributedAt]);
}

describePostgres("growth qualification and risk history readers", () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error("ACTION_PG_TEST_URL is required");
    admin = new Bun.SQL(connectionString);
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${schema}`);
      for (const migration of await readAllMigrationSql()) await tx.unsafe(migration);
    });
    sql = createPostgresSqlExecutor(connectionString, { schema });
  });
  beforeEach(async () => {
    await sql.query("DELETE FROM customers");
    await sql.query("TRUNCATE history_assets, chain_buckets CASCADE");
    const inviter = await customer("1");
    const invitee = await customer("2");
    const other = await customer("3");
    inviteeHistory = invitee.historyId;
    inviterHistory = inviter.historyId;
    otherHistory = other.historyId;
    const asset = await sql.query<{ id: number }>(`INSERT INTO history_assets (chain_id,asset_key,kind,contract_address,decimals)
      VALUES ($1,$2,'vault-share',$3,18) RETURNING id`, [BASE_CHAIN_ID, `eip155:${BASE_CHAIN_ID}/erc20:${vault}`, vault]);
    vaultAsset = required(asset.rows[0]).id;
    const usdc = await sql.query<{ id: number }>(`INSERT INTO history_assets (chain_id,asset_key,kind,contract_address,decimals)
      VALUES ($1,'usdc','erc20',$2,6) RETURNING id`, [BASE_CHAIN_ID, BASE_USDC_ADDRESS.toLowerCase()]);
    usdcAsset = required(usdc.rows[0]).id;
    await sql.query(`INSERT INTO balance_checkpoints (address_id,asset_id,block_number,purpose,chain_quantity,observed_at)
      VALUES ($1,$2,1,'window-start',0,$3)`, [inviteeHistory, vaultAsset, at(-10)]);
    await sql.query(`INSERT INTO chain_buckets (chain_id,bucket_at,block_number,block_hash,block_time)
      VALUES ($1,$2,100,decode($3,'hex'),$2)`, [BASE_CHAIN_ID, at(60), "ef".repeat(32)]);
    const actionId = randomUUID();
    const summary = { metadata: { product: "savings", operation: "deposit", vaultAddress: vault, network: { chainId: BASE_CHAIN_ID } },
      amounts: [{ assetId: `eip155:${BASE_CHAIN_ID}/erc20:${BASE_USDC_ADDRESS.toLowerCase()}`, direction: "spend", amountBaseUnits: "100" }] };
    await sql.query(`INSERT INTO actions (id,owner_key,provider,kind,summary,customer_id,confirmed_at,transaction_hash,
      outcome,outcome_source,outcome_recorded_at,settled_at,observed_receipt_block_number,observed_receipt_transaction_hash)
      VALUES ($1,'owner','base-account','savings-deposit',$2::jsonb,$3,$4,$5,'succeeded','chain',$4,$4,10,$5)`,
      [actionId, JSON.stringify(summary), invitee.customerId, start, hash]);
    await addChange(inviteeHistory, vaultAsset, "10", 0);
    row = { id: randomUUID(), inviteeCustomerId: invitee.customerId, inviterCustomerId: inviter.customerId, terms,
      attributedAt: at(-1), state: "saved", depositActionId: actionId, depositTxHash: hash, depositAt: start,
      depositSharesAtoms: BigInt(10), windowEndsAt: at(30) };
  });
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  });

  test("joined rewards first return a saved anchor; elapsed saved rewards qualify", async () => {
    expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, at(10))).toMatchObject({ kind: "saved",
      deposit: { assetsAtoms: BigInt(100), sharesAtoms: BigInt(10), at: start, windowEndsAt: at(30) } });
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "qualified", qualifiedAt: at(30), minSharesAtoms: BigInt(10) });
  });
  test("same-block NULL-hash extra mint is counted and a balance below the aggregate disqualifies", async () => {
    await addChange(inviteeHistory, vaultAsset, "5", 0, 10, 2);
    expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, at(10)))
      .toMatchObject({ kind: "saved", deposit: { sharesAtoms: BigInt(15) }, minSharesAtoms: BigInt(15) });
    await addChange(inviteeHistory, vaultAsset, "-1", 1);
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "disqualified", minSharesAtoms: BigInt(14) });
  });
  test("persisted same-block mixed-hash dip with NULL-hash tail disqualifies", async () => {
    await seedMixedHashDip();
    await addChange(inviteeHistory, vaultAsset, "1", 0, 10, 4);
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "disqualified", minSharesAtoms: BigInt(0) });
  });
  test("adding a NULL-hash tail cannot qualify a proven mixed-hash dip", async () => {
    await seedMixedHashDip();
    const before = await evaluateReward(sql, row, at(40));
    expect(before).toMatchObject({ kind: "disqualified", minSharesAtoms: BigInt(0) });
    await addChange(inviteeHistory, vaultAsset, "1", 0, 10, 4);
    expect(await evaluateReward(sql, row, at(40))).toEqual(before);
  });
  test("NULL-hash deposit with hashed dip and redeposit stays unavailable despite a NULL-hash tail", async () => {
    await seedMixedHashDip();
    await sql.query("UPDATE balance_changes SET tx_hash=NULL WHERE address_id=$1 AND asset_id=$2 AND log_index=1",
      [inviteeHistory, vaultAsset]);
    await addChange(inviteeHistory, vaultAsset, "1", 0, 10, 4);
    for (const now of [at(10), at(40)]) {
      expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, now))
        .toEqual({ kind: "pending", reason: "history-unavailable" });
      expect(await evaluateReward(sql, row, now)).toEqual({ kind: "pending", reason: "history-unavailable" });
    }
  });
  test("receipt block without a bound share change stays history-unavailable before and after the window", async () => {
    await sql.query("UPDATE balance_changes SET block_number=11,block_time=$1", [at(1)]);
    for (const now of [at(10), at(40)]) expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, now))
      .toEqual({ kind: "pending", reason: "history-unavailable" });
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test.each(["reconcile", "bucket", "window-start"] as const)("%s checkpoint mismatch leaves qualification and anchoring pending", async (purpose) => {
    await sql.query(`INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,log_quantity,observed_at)
      VALUES ($1,$2,$3,$4,0,10,$5) ON CONFLICT (address_id,asset_id,block_number) DO UPDATE SET log_quantity=10`,
    [inviteeHistory, vaultAsset, purpose === "window-start" ? 1 : 20, purpose, at(10)]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
    expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, at(10)))
      .toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test.each(["10", null])("reconcile log quantity %s outside enrolled forward range does not block qualification", async (logQuantity) => {
    for (const block of [0, 101]) await sql.query(`INSERT INTO balance_checkpoints
      (address_id,asset_id,block_number,purpose,chain_quantity,log_quantity,observed_at) VALUES ($1,$2,$3,'reconcile',0,$4,$5)`,
    [inviteeHistory, vaultAsset, block, logQuantity, at(40)]);
    expect((await evaluateReward(sql, row, at(40))).kind).toBe("qualified");
  });
  test.each([1, 100])("uncompared reconcile checkpoint at boundary block %s leaves qualification pending", async (block) => {
    await sql.query(`INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,observed_at)
      VALUES ($1,$2,$3,'reconcile',0,$4) ON CONFLICT (address_id,asset_id,block_number) DO UPDATE SET purpose='reconcile',chain_quantity=0,log_quantity=NULL`,
    [inviteeHistory, vaultAsset, block, at(40)]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("ordinary window-start and bucket checkpoints with NULL log quantities remain valid", async () => {
    await sql.query(`INSERT INTO balance_checkpoints(address_id,asset_id,block_number,purpose,chain_quantity,observed_at)
      VALUES ($1,$2,20,'bucket',10,$3)`, [inviteeHistory, vaultAsset, at(10)]);
    expect((await evaluateReward(sql, row, at(40))).kind).toBe("qualified");
  });
  test("deposit visible with ingestion one second behind now anchors while the window runs", async () => {
    await sql.query("UPDATE history_addresses SET ingested_at=$2 WHERE id=$1", [inviteeHistory, new Date(at(10).getTime() - 1000)]);
    await sql.query("UPDATE chain_buckets SET block_time=$1", [at(9)]);
    expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, at(10)))
      .toMatchObject({ kind: "saved", deposit: { txHash: hash } });
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-behind" });
  });
  test("recorded deposit B still progresses when an earlier qualifying A is observed later", async () => {
    expect(await evaluateReward(sql, { ...row, state: "joined", depositTxHash: null }, at(10)))
      .toMatchObject({ kind: "saved", deposit: { txHash: hash, at: start } });
    const earlierHash = `0x${"ef".repeat(32)}`;
    await sql.query(`INSERT INTO actions(id,owner_key,provider,kind,summary,customer_id,confirmed_at,transaction_hash,
      outcome,outcome_source,outcome_recorded_at,settled_at,observed_receipt_block_number,observed_receipt_transaction_hash)
      SELECT $1,owner_key,provider,kind,summary,customer_id,$2,$3,outcome,outcome_source,$2,$2,9,$3 FROM actions WHERE id=$4`,
    [randomUUID(), at(-1), earlierHash, row.depositActionId]);
    await addChange(inviteeHistory, vaultAsset, "10", -1, 9);
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "qualified", qualifiedAt: at(30), minSharesAtoms: BigInt(20) });
    expect(await evaluateReward(sql, { ...row, depositTxHash: `0x${"ff".repeat(32)}` }, at(40)))
      .toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("a recycled-capital dip disqualifies even after redeposit", async () => {
    await addChange(inviteeHistory, vaultAsset, "-10", 1);
    await addChange(inviteeHistory, vaultAsset, "10", 2);
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "disqualified", minSharesAtoms: BigInt(0) });
  });
  test("post-window activity beyond reconciliation cannot hide a corroborated in-window dip", async () => {
    await addChange(inviteeHistory, vaultAsset, "-1", 1);
    await addChange(inviteeHistory, vaultAsset, "1", 31);
    await sql.query(`UPDATE balance_checkpoints SET block_number=11,chain_quantity=9,log_quantity=9
      WHERE address_id=$1 AND asset_id=$2 AND purpose='reconcile'`, [inviteeHistory, vaultAsset]);
    expect(await evaluateReward(sql, row, at(40))).toMatchObject({ kind: "disqualified", reason: "balance-dropped", minSharesAtoms: BigInt(9) });
  });
  test("unknown or incomplete history is pending", async () => {
    await sql.query("DELETE FROM balance_checkpoints");
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
    await sql.query("DELETE FROM history_addresses WHERE id=$1", [inviteeHistory]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("ingestion wall time without chain block-time coverage is pending", async () => {
    await sql.query("UPDATE chain_buckets SET block_time=$1", [at(20)]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-behind" });
  });
  test("missing ledger transaction is pending", async () => {
    await sql.query("DELETE FROM balance_changes");
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("another vault's mint cannot satisfy the deposit", async () => {
    await sql.query("UPDATE history_assets SET contract_address=$1 WHERE id=$2", [`0x${"9".repeat(40)}`, vaultAsset]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("a change result over the cap is pending, never truncated success", async () => {
    await sql.query(`INSERT INTO balance_changes (address_id,asset_id,block_number,log_index,block_time,tx_hash,delta,source)
      SELECT $1,$2,11,g,$3,NULL,0,'cdp-sql-transfer' FROM generate_series(1,10001) g`, [inviteeHistory, vaultAsset, at(1)]);
    expect(await evaluateReward(sql, row, at(40))).toEqual({ kind: "pending", reason: "history-unavailable" });
  });
  test("empty history returns no risk signals", async () => {
    await sql.query("DELETE FROM history_addresses");
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
  test("pre-existing checkpoint shares are flagged", async () => {
    await sql.query("UPDATE balance_checkpoints SET chain_quantity=1");
    expect(await computeRiskSignals(sql, row, at(40))).toEqual(["preexisting-shares"]);
  });
  test("withdrawal after the window qualifies and raises a risk signal", async () => {
    await addChange(inviteeHistory, vaultAsset, "-10", 31);
    expect((await evaluateReward(sql, row, at(40))).kind).toBe("qualified");
    expect(await computeRiskSignals(sql, row, at(40))).toEqual(["withdrew-after-window"]);
  });
  test("withdrawal outside 72 hours does not raise a signal", async () => {
    await addChange(inviteeHistory, vaultAsset, "-10", 34);
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
  for (const source of ["inviter", "customer"] as const) test(`funding by ${source} matches both sides of the same NULL-hash USDC log`, async () => {
    await addChange(inviteeHistory, usdcAsset, "100", -1, 9);
    await addChange(source === "inviter" ? inviterHistory : otherHistory, usdcAsset, "-100", -1, 9);
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([source === "inviter" ? "funded-by-inviter" : "funded-by-customer"]);
  });
  test.each([{ block: 9, log: 2 }, { block: 8, log: 1 }])("NULL-hash funding at block $block log $log is not the same transfer", async ({ block, log }) => {
    await addChange(inviteeHistory, usdcAsset, "100", -1, 9, 1);
    await addChange(inviterHistory, usdcAsset, "-100", -1, block, log);
    await addChange(otherHistory, usdcAsset, "-100", -1, block, log);
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
  test("the invitee's own same-log debit is not customer funding", async () => {
    await addChange(inviteeHistory, usdcAsset, "100", -1, 9, 1);
    const ownWallet = await customer("4");
    await sql.query("UPDATE customer_wallets SET customer_id=$1 WHERE customer_id=$2", [row.inviteeCustomerId, ownWallet.customerId]);
    await addChange(ownWallet.historyId, usdcAsset, "-100", -1, 9, 1);
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
  test("unmatched funding and out-of-lookback funding do not signal", async () => {
    await addChange(inviteeHistory, usdcAsset, "100", -8, 2);
    await addChange(inviterHistory, usdcAsset, "-100", -8, 2);
    await addChange(inviteeHistory, usdcAsset, "100", -1, 9);
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
  test("program-wide signup and per-inviter burst thresholds include this attribution", async () => {
    for (const digit of ["4", "5", "6", "7", "8"]) {
      const invitee = await customer(digit);
      await seedReward(invitee.customerId, row.inviterCustomerId, at(-1));
    }
    expect(await computeRiskSignals(sql, row, at(40))).toEqual(["signup-burst", "inviter-burst"]);
  });
  test("attributions outside the rolling windows do not count", async () => {
    for (const digit of ["4", "5", "6", "7", "8"]) {
      const invitee = await customer(digit);
      await seedReward(invitee.customerId, row.inviterCustomerId, at(-3));
    }
    expect(await computeRiskSignals(sql, row, at(40))).toEqual([]);
  });
});
