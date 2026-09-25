import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { ActionsStore, actionOwnerKey } from "./store";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const schema = "cashout_lockout_test";
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
const owner = { subject: "cashout-lockout", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
let admin: BunSqlClient;
const otherOwner = { ...owner, subject: "another-customer" };
let sql: SqlExecutor;
let store: ActionsStore;

async function insertOrder(createdAt: string, depositId: string | null = null, state = "submitted", inputOwner = owner) {
  const id = randomUUID();
  await store.insert({ id, owner: inputOwner, kind: "cash-out", summary: { title: "Cash out", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" }, pending: { calls: [] }, createdAt });
  await sql.query("UPDATE actions SET confirmed_at = $2::timestamptz, pending = NULL WHERE id = $1", [id, createdAt]);
  await sql.query(
    `INSERT INTO cashout_orders (action_id, owner_key, provider_id, environment, region, platform, platform_label, amount_atomic, remaining_atomic, eta_seconds, deposit_id, state, created_at)
     VALUES ($1, $2, 'peer', 'production', 'US', 'cashapp', 'Cash App', '2000000', '2000000', 100, $3, $4, $5::timestamptz)`,
    [id, actionOwnerKey(inputOwner), depositId, state, createdAt],
  );
  return id;
}

async function insertNewerActions() {
  const ids = Array.from({ length: 101 }, () => randomUUID());
  await sql.query(
    `INSERT INTO actions (id, owner_key, provider, kind, summary, pending, created_at, confirmed_at)
     SELECT id, $2, 'cdp-embedded', 'send', $3::jsonb, NULL, now(), now() - (102 - ordinal) * interval '1 second'
     FROM unnest($1::uuid[]) WITH ORDINALITY AS newer(id, ordinal)`,
    [ids, actionOwnerKey(owner), JSON.stringify({ title: "Send", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" })],
  );
}

describePostgres("cash-out lockout eligibility", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
      await transaction.unsafe(await readMigrationSql("001_actions.sql"));
      await transaction.unsafe(await readMigrationSql("012_action_outcomes.sql"));
      await transaction.unsafe(await readMigrationSql("013_action_call_commitment.sql"));
      await transaction.unsafe(await readMigrationSql("014_cashout_orders.sql"));
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

  test("claims refresh time only for unsettled cash-outs", async () => {
    const unsettled = await insertOrder(new Date().toISOString());
    const settled = await insertOrder(new Date().toISOString());
    await sql.query("UPDATE cashout_orders SET settled_at = now() WHERE action_id = $1", [settled]);

    await store.claimCashoutRefresh(owner, unsettled);
    await store.claimCashoutRefresh(owner, settled);
    const orders = await store.cashoutOrders(owner, [unsettled, settled]);
    expect(orders.find((order) => order.action_id === unsettled)?.refreshed_at).not.toBeNull();
    expect(orders.find((order) => order.action_id === settled)?.refreshed_at).toBeNull();
  });

  test("receipt proof atomically releases a same-owner speculative link, including settled progress", async () => {
    const speculative = await insertOrder(new Date().toISOString(), "DePoSiT_7");
    const proven = await insertOrder(new Date().toISOString());
    await sql.query(
      `UPDATE cashout_orders SET state = 'delivered', filled_atomic = '2000000', remaining_atomic = '0',
         withdrawable = true, settled_at = now() WHERE action_id = $1`, [speculative],
    );

    expect(await store.linkCashoutDeposit(owner, proven, "deposit_7", true)).toMatchObject({
      action_id: proven, deposit_id: "deposit_7", deposit_proven: true,
    });
    expect((await store.cashoutOrders(owner, [speculative, proven])).find((row) => row.action_id === speculative)).toMatchObject({
      deposit_id: null, deposit_proven: false, state: "submitted", filled_atomic: "0", returned_atomic: "0",
      remaining_atomic: "2000000", withdrawable: false, settled_at: null,
    });
  });

  test("a receipt cannot displace another receipt-proven link", async () => {
    const linked = await insertOrder(new Date().toISOString(), "deposit_8");
    const target = await insertOrder(new Date().toISOString());
    await sql.query("UPDATE cashout_orders SET deposit_proven = true WHERE action_id = $1", [linked]);

    expect(await store.linkCashoutDeposit(owner, target, "DEPOSIT_8", true)).toBeNull();
    expect(await store.cashoutOrders(owner, [linked, target])).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_id: linked, deposit_id: "deposit_8", deposit_proven: true }),
      expect.objectContaining({ action_id: target, deposit_id: null }),
    ]));
  });

  test("receipt proof never displaces another owner's link", async () => {
    const linked = await insertOrder(new Date().toISOString(), "deposit_9", "submitted", otherOwner);
    const target = await insertOrder(new Date().toISOString());

    expect(await store.linkCashoutDeposit(owner, target, "DEPOSIT_9", true)).toBeNull();
    expect((await store.cashoutOrders(otherOwner, [linked]))[0]).toMatchObject({ deposit_id: "deposit_9", deposit_proven: false });
    expect((await store.cashoutOrders(owner, [target]))[0]).toMatchObject({ deposit_id: null, deposit_proven: false });
  });

  test("a speculative link never displaces an earlier link", async () => {
    const linked = await insertOrder(new Date().toISOString(), "deposit_10");
    const target = await insertOrder(new Date().toISOString());

    expect(await store.linkCashoutDeposit(owner, target, "DEPOSIT_10", false)).toBeNull();
    expect((await store.cashoutOrders(owner, [linked]))[0]).toMatchObject({ deposit_id: "deposit_10", deposit_proven: false });
    expect((await store.cashoutOrders(owner, [target]))[0]).toMatchObject({ deposit_id: null });
  });

  test("stale unlinked submitted cash-out does not block a new deposit", async () => {
    await insertOrder(new Date(Date.now() - 16 * 60_000).toISOString());
    expect(await store.hasUnsettledCashout(owner)).toBe(false);
  });

  test("stale unlinked cash-out with a dispatch handle or hash still blocks", async () => {
    const handled = await insertOrder(new Date(Date.now() - 16 * 60_000).toISOString());
    await sql.query("UPDATE actions SET provider_handle = 'op-1', handle_recorded_at = now() WHERE id = $1", [handled]);
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
    await sql.query("UPDATE actions SET provider_handle = NULL, handle_recorded_at = NULL, transaction_hash = '0xabc' WHERE id = $1", [handled]);
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
  });

  test("fresh unlinked submitted cash-out still blocks", async () => {
    await insertOrder(new Date().toISOString());
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
  });

  test("a fresh cash-out the wallet declined does not block until it is retried", async () => {
    const declined = await insertOrder(new Date().toISOString());
    await sql.query("UPDATE actions SET confirmed_at = now(), declined_reported_at = now() WHERE id = $1", [declined]);
    expect(await store.hasUnsettledCashout(owner)).toBe(false);
    await sql.query("UPDATE actions SET declined_reported_at = NULL, dispatch_attempt = 1 WHERE id = $1", [declined]);
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
  });

  test("a fresh cash-out the wallet never submitted does not block unless its deposit is proven", async () => {
    const unsubmitted = await insertOrder(new Date().toISOString(), "deposit_8");
    await sql.query("UPDATE actions SET outcome = 'not_submitted', outcome_source = 'wallet', outcome_recorded_at = now() WHERE id = $1", [unsubmitted]);
    expect(await store.hasUnsettledCashout(owner)).toBe(false);
    await sql.query("UPDATE cashout_orders SET deposit_proven = true WHERE action_id = $1", [unsubmitted]);
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
  });

  test("linked unsettled cash-out blocks regardless of age", async () => {
    await insertOrder(new Date(Date.now() - 60 * 60_000).toISOString(), "deposit_7");
    expect(await store.hasUnsettledCashout(owner)).toBe(true);
  });

  test("a provisionally failed linked cash-out blocks until its durable record settles", async () => {
    const provisional = await insertOrder(new Date().toISOString(), "deposit_7", "failed");
    expect((await store.cashoutOrders(owner, [provisional]))[0]).toMatchObject({ deposit_proven: false, settled_at: null });
    expect(await store.hasUnsettledCashout(owner)).toBe(true);

    await sql.query("UPDATE cashout_orders SET settled_at = now() WHERE action_id = $1", [provisional]);
    expect(await store.hasUnsettledCashout(owner)).toBe(false);
  });

  test("keeps an older unsettled cash-out despite 101 newer confirmed actions and sorts the result newest first", async () => {
    const old = await insertOrder(new Date(Date.now() - 45 * 86_400_000).toISOString(), "deposit_7");
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '45 days' WHERE id = $1", [old]);
    await insertNewerActions();
    const listed = await store.list(owner);
    expect(listed).toHaveLength(100);
    expect(listed.map(({ id }) => id)).toContain(old);
    expect(listed.at(-1)?.id).toBe(old);
    expect(listed.every((row, index) => index === 0 || new Date(listed[index - 1]!.confirmed_at!).getTime() >= new Date(row.confirmed_at!).getTime())).toBe(true);
  });

  test("retains an older withdrawal linked to an unsettled cash-out but not one linked to a settled order", async () => {
    const old = await insertOrder(new Date(Date.now() - 45 * 86_400_000).toISOString(), "DePoSiT_7");
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '45 days' WHERE id = $1", [old]);
    const settled = await insertOrder(new Date(Date.now() - 10 * 86_400_000).toISOString(), "deposit_8");
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '10 days' WHERE id = $1", [settled]);
    await sql.query("UPDATE cashout_orders SET settled_at = now() WHERE action_id = $1", [settled]);

    const insertWithdrawal = async (depositId: string, daysAgo: number) => {
      const id = randomUUID();
      await store.insert({ id, owner, kind: "cash-out-withdraw", summary: {
        title: "Withdraw cash-out", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
        metadata: {
          product: "cashout", operation: "withdraw", depositId, providerId: "peer", providerName: "Peer",
          environment: "production", region: "US", platform: "cashapp", platformLabel: "Cash App",
          currency: "USD", approximateFiatAmount: "2", minConversionRate: "1",
          intentAmountRange: { min: "2000000", max: "2000000" }, estimateAsOf: "2026-09-12T00:00:00.000Z",
          escrow: owner.address,
        },
      }, pending: { calls: [] }, createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });
      await sql.query("UPDATE actions SET confirmed_at = now() - $2 * interval '1 day' WHERE id = $1", [id, daysAgo]);
      return id;
    };
    const withdrawal = await insertWithdrawal("deposit_7", 44);
    const settledWithdrawal = await insertWithdrawal("DEPOSIT_8", 9);
    const unlinkedWithdrawal = randomUUID();
    await store.insert({ id: unlinkedWithdrawal, owner, kind: "cash-out-withdraw", summary: {
      title: "Unlinked withdrawal", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
    }, pending: { calls: [] }, createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString() });
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '9 days' WHERE id = $1", [unlinkedWithdrawal]);
    await insertNewerActions();

    const listed = await store.list(owner);
    expect(listed).toHaveLength(100);
    expect(listed.map(({ id }) => id)).toContain(old);
    expect(listed.map(({ id }) => id)).toContain(withdrawal);
    expect(listed.map(({ id }) => id)).not.toContain(settledWithdrawal);
    expect(listed.map(({ id }) => id)).not.toContain(unlinkedWithdrawal);
    expect(listed.at(-2)?.id).toBe(withdrawal);
    expect(listed.at(-1)?.id).toBe(old);
  });

  test("keeps an older cash-out without an order for lazy backfill and scopes linked deposits", async () => {
    const old = await insertOrder(new Date(Date.now() - 60 * 86_400_000).toISOString());
    await sql.query("DELETE FROM cashout_orders WHERE action_id = $1", [old]);
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '60 days', summary = $2::jsonb WHERE id = $1", [old,
      JSON.stringify({ title: "Cash out", amounts: [{ assetId: "usdc", direction: "spend", amountBaseUnits: "2000000" }],
        warnings: [], expiresAt: "2099-01-01T00:00:00.000Z", metadata: {
          product: "cashout", operation: "deposit", providerId: "peer", providerName: "Peer", environment: "production",
          region: "US", platform: "cashapp", platformLabel: "Cash App", currency: "USD", canonicalHandle: "alice",
          approximateFiatAmount: "2", etaSeconds: 100, minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
          estimateAsOf: "2026-09-12T00:00:00.000Z", escrow: "0x1111111111111111111111111111111111111111",
        } }),
    ]);
    await insertNewerActions();
    const listed = await store.list(owner);
    expect(listed).toHaveLength(100);
    expect(listed.at(-1)?.id).toBe(old);
    const backfilled = await store.ensureCashoutOrder(owner, listed.at(-1)!);
    expect(backfilled).toMatchObject({ action_id: old, state: "submitted" });
    expect(Date.now() - new Date(backfilled!.created_at).getTime()).toBeGreaterThan(59 * 86_400_000);
    expect(await store.hasUnsettledCashout(owner)).toBe(false);
    await insertOrder(new Date().toISOString(), "DePoSiT_8");
    expect(await store.linkedCashoutDepositIds(owner, "peer")).toEqual(["deposit_8"]);
    expect(await store.linkedCashoutDepositIds({ ...owner, subject: "other" }, "peer")).toEqual([]);
    expect(await store.linkedCashoutDepositIds(owner, "another-provider")).toEqual([]);
  });
});
