import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { keccak256 } from "viem";
import { encodeCoinbaseExecuteBatch } from "@/server/chain/coinbase-smart-account";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { readMigrationSql } from "@/tests/helpers/migrations";
import { ActionsStore, actionOwnerKey } from "./store";
import type { TradeMoneyActionMetadata } from "@/shared/trading/contract";

const connectionString = process.env.ACTION_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
const TEST_SCHEMA = "actions_contract_test";
type BunSqlClient = { unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>; begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>; close(): Promise<void> };
let admin: BunSqlClient;
let sql: SqlExecutor;
let store: ActionsStore;
const owner = { subject: "action-pg", address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const, accountProvider: "cdp-embedded" as const };
const baseOwner = { ...owner, subject: "action-pg-base", accountProvider: "base-account" as const };
const otherOwner = { ...owner, subject: "action-pg-other" };
const summary = { title: "Send USDC", amounts: [], warnings: [], expiresAt: "2099-01-01T00:00:00.000Z" };
const calls = [{ to: owner.address, data: "0x1234" as const, value: "0" }];
const cashoutSummary = {
  title: "Cash out with Peer", amounts: [{ assetId: "usdc", direction: "spend", amountBaseUnits: "2000000" }],
  warnings: [], expiresAt: "2099-01-01T00:00:00.000Z",
  metadata: { product: "cashout" as const, operation: "deposit" as const, providerId: "peer", providerName: "Peer",
    environment: "production" as const, region: "US", platform: "cashapp", platformLabel: "Cash App", currency: "USD",
    approximateFiatAmount: "2", etaSeconds: 100, minConversionRate: "1", intentAmountRange: { min: "2000000", max: "2000000" },
    estimateAsOf: "2026-09-12T00:00:00.000Z", escrow: "0x1111111111111111111111111111111111111111" as const, canonicalHandle: "alice" },
};

describePostgres("actions schema and store", () => {
  beforeAll(async () => {
    admin = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const migration = await readMigrationSql("001_actions.sql");
    const outcomesMigration = await readMigrationSql("012_action_outcomes.sql");
    const callCommitmentMigration = await readMigrationSql("013_action_call_commitment.sql");
    const cashoutMigration = await readMigrationSql("014_cashout_orders.sql");
    const providerProgressMigration = await readMigrationSql("021_cashout_provider_progress.sql");
    const observationsMigration = await readMigrationSql("016_action_receipt_observations.sql");
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.unsafe(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL search_path TO ${TEST_SCHEMA}`);
      await transaction.unsafe(`CREATE TABLE schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await transaction.unsafe(migration);
      await transaction.unsafe(outcomesMigration);
      await transaction.unsafe(callCommitmentMigration);
      await transaction.unsafe(cashoutMigration);
      await transaction.unsafe(observationsMigration);
      await transaction.unsafe(observationsMigration);
      await transaction.unsafe(providerProgressMigration);
      for (const file of ["002_funding_provider_seam.sql", "007_funding_provider_customers.sql", "008_funding_provider_user_tokens.sql", "011_operator_registry.sql", "017_record_customer_ids.sql"]) {
        await transaction.unsafe(await readMigrationSql(file));
      }
      await transaction.unsafe("INSERT INTO schema_migrations (name) VALUES ($1), ($2), ($3), ($4), ($5), ($6)", ["db/001_actions.sql", "db/012_action_outcomes.sql", "db/013_action_call_commitment.sql", "db/014_cashout_orders.sql", "db/016_action_receipt_observations.sql", "db/021_cashout_provider_progress.sql"]);
    });
    sql = createPostgresSqlExecutor(connectionString!, { schema: TEST_SCHEMA });
    store = new ActionsStore(sql);
  });
  beforeEach(async () => {
    const clock = await sql.query<{ instant: Date }>("SELECT now() AS instant");
    setSystemTime(clock.rows[0]!.instant);
    await sql.query("TRUNCATE actions CASCADE");
  });
  afterEach(() => setSystemTime());
  afterAll(async () => {
    await sql?.dispose?.();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin?.close();
  });

  test("uses the migrate-first actions schema with migration tracking", async () => {
    const tables = await sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('actions','cashout_orders','schema_migrations') ORDER BY table_name",
      [TEST_SCHEMA],
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(["actions", "cashout_orders", "schema_migrations"]);
    const columns = await sql.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'actions' ORDER BY ordinal_position",
      [TEST_SCHEMA],
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "id", "owner_key", "provider", "kind", "summary", "pending", "created_at",
      "confirmed_at", "provider_handle", "transaction_hash", "handle_recorded_at",
      "account_address", "declined_reported_at", "dispatch_attempt", "outcome", "outcome_source", "settled_at", "outcome_recorded_at", "confirmed_call_data_hash",
      "observed_receipt_transaction_hash", "observed_receipt_block_number", "observed_receipt_block_hash", "observed_receipt_outcome", "observed_at",
      "customer_id", "credential_id", "wallet_id",
    ]);
  });

  test("scopes reads, clears pending on confirm, and records immutable handles", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    expect(await store.get(otherOwner, id)).toBeNull();
    const confirmed = await store.confirm(owner, id);
    expect(confirmed?.pending?.calls).toEqual(calls);
    expect(confirmed?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(calls)));
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(calls)));
    expect((await store.get(owner, id))?.pending).toBeNull();
    expect((await store.get(owner, id))?.confirmed_at).not.toBeNull();
    expect((await store.recordHandle(owner, id, { providerHandle: `0x${"ab".repeat(32)}` }))?.provider_handle).toBe(`0x${"ab".repeat(32)}`);
    expect(await store.recordHandle(owner, id, { providerHandle: `0x${"cd".repeat(32)}` })).toBeNull();
  });

  test("receipt observations require owner, matching transaction hash, open outcome, and matching block on clear", async () => {
    const id = randomUUID();
    const hash = `0x${"ab".repeat(32)}`;
    const otherHash = `0x${"cd".repeat(32)}`;
    const block = `0x${"ef".repeat(32)}`;
    const nextBlock = `0x${"01".repeat(32)}`;
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, id);
    const observation = { transactionHash: hash.toUpperCase().replace("0X", "0x"), blockNumber: "16", blockHash: block, outcome: "succeeded" as const };
    expect(await store.recordReceiptObservation(owner, id, observation)).toBeNull();
    await store.recordHandle(owner, id, { transactionHash: hash });
    expect(await store.recordReceiptObservation(otherOwner, id, observation)).toBeNull();
    expect(await store.recordReceiptObservation(owner, id, { ...observation, transactionHash: otherHash })).toBeNull();
    expect(await store.recordReceiptObservation(owner, id, observation)).toMatchObject({
      observed_receipt_transaction_hash: observation.transactionHash, observed_receipt_block_number: "16", observed_receipt_outcome: "succeeded",
    });
    expect(await store.recordReceiptObservation(owner, id, observation)).toBeNull();
    expect(await store.recordReceiptObservation(owner, id, { ...observation, outcome: "reverted" })).toMatchObject({
      observed_receipt_block_hash: block, observed_receipt_outcome: "reverted",
    });
    expect(await store.recordReceiptObservation(owner, id, { ...observation, blockHash: nextBlock, outcome: "reverted" })).toMatchObject({
      observed_receipt_block_hash: nextBlock, observed_receipt_outcome: "reverted",
    });
    expect(await store.clearReceiptObservation(otherOwner, id, nextBlock)).toBeNull();
    expect(await store.clearReceiptObservation(owner, id, block)).toBeNull();
    expect((await store.get(owner, id))?.observed_receipt_outcome).toBe("reverted");
    expect(await store.clearReceiptObservation(owner, id, nextBlock)).toMatchObject({ observed_receipt_outcome: null, observed_at: null });
    await store.recordReceiptObservation(owner, id, observation);
    await store.recordOutcome(owner, id, { outcome: "succeeded", source: "chain", settledAt: new Date() });
    expect(await store.recordReceiptObservation(owner, id, { ...observation, outcome: "reverted" })).toBeNull();
    expect(await store.clearReceiptObservation(owner, id, block)).toBeNull();
  });

  test("confirmation commits finalized calls rather than the pending draft", async () => {
    const id = randomUUID();
    const finalCalls = [{ ...calls[0]!, data: "0x5678" as const }];
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBeNull();
    expect((await store.confirm(owner, id, finalCalls))?.pending?.calls).toEqual(finalCalls);
    expect((await store.getForPaymaster(id))?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(finalCalls)));
  });

  test("trade confirmation keeps only the committed plan until a handle or outcome exists", async () => {
    const finalCalls = [{ ...calls[0]!, data: "0x5678" as const }];
    const handled = randomUUID();
    const settled = randomUUID();
    const tradeSummary = { ...summary, metadata: { product: "trade", direction: "buy", executionDeadline: String(Math.floor(Date.now() / 1000) + 300) } as TradeMoneyActionMetadata };
    for (const id of [handled, settled]) {
      await store.insert({ id, owner, kind: "trade", summary: tradeSummary, pending: { calls, swapCallIndex: 0 }, createdAt: "2026-09-12T10:00:00.000Z" });
      await store.confirm(owner, id, finalCalls);
      expect((await store.get(owner, id))?.pending).toEqual({ calls: finalCalls });
    }
    await store.recordHandle(owner, handled, { providerHandle: `0x${"ab".repeat(32)}` });
    expect((await store.get(owner, handled))?.pending).toBeNull();
    await store.recordOutcome(owner, settled, { outcome: "not_submitted", source: "wallet", settledAt: null });
    expect((await store.get(owner, settled))?.pending).toBeNull();
  });

  test("inserts and confirms another trade while a dispatched trade has no outcome", async () => {
    const tradeSummary = { ...summary, metadata: { product: "trade", direction: "buy", executionDeadline: String(Math.floor(Date.now() / 1000) + 300) } as TradeMoneyActionMetadata };
    const first = randomUUID();
    const second = randomUUID();
    await store.insert({ id: first, owner, kind: "trade", summary: tradeSummary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, first);
    await store.recordHandle(owner, first, { providerHandle: `0x${"ab".repeat(32)}` });
    expect((await store.get(owner, first))?.outcome).toBeNull();
    await store.insert({ id: second, owner, kind: "trade", summary: tradeSummary, pending: { calls }, createdAt: new Date().toISOString() });
    const confirmed = await store.confirm(owner, second);
    expect(confirmed?.id).toBe(second);
    expect(confirmed?.confirmed_at).not.toBeNull();
    expect(confirmed?.confirmed_call_data_hash).toBe(keccak256(encodeCoinbaseExecuteBatch(calls)));
    expect((await store.get(owner, first))?.outcome).toBeNull();
  });

  test("confirmation without pending calls does not write a commitment", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });
    await sql.query("UPDATE actions SET pending = NULL WHERE id = $1", [id]);
    expect((await store.confirm(owner, id))?.confirmed_call_data_hash).toBeNull();
  });

  test("base-account confirmation leaves the provider handle empty until the wallet handle is recorded", async () => {
    const id = randomUUID();
    const walletHandle = `0x${"ef".repeat(32)}`;
    await store.insert({ id, owner: baseOwner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T10:00:00.000Z" });

    expect((await store.confirm(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.get(baseOwner, id))?.provider_handle).toBeNull();
    expect((await store.recordHandle(baseOwner, id, { providerHandle: walletHandle }))?.provider_handle).toBe(walletHandle);
  });

  test("lists bounded dispatched sends across history with owner isolation", async () => {
    const older = randomUUID();
    const newer = randomUUID();
    const reviewedOnly = randomUUID();
    const other = randomUUID();
    for (const [id, actionOwner] of [[older, owner], [newer, owner], [reviewedOnly, owner], [other, otherOwner]] as const) {
      await store.insert({ id, owner: actionOwner, kind: "send", summary, pending: { calls }, createdAt: "2020-01-01T00:00:00.000Z" });
      await store.confirm(actionOwner, id);
    }
    await store.recordHandle(owner, older, { providerHandle: `0x${"11".repeat(32)}` });
    await store.recordHandle(owner, newer, { transactionHash: `0x${"22".repeat(32)}` });
    await store.recordHandle(otherOwner, other, { providerHandle: `0x${"33".repeat(32)}` });
    await sql.query("UPDATE actions SET confirmed_at = CASE id WHEN $1 THEN $3::timestamptz WHEN $2 THEN $4::timestamptz ELSE $5::timestamptz END", [
      older,
      newer,
      "2020-01-01T00:00:00.000Z",
      "2020-02-01T00:00:00.000Z",
      "2020-03-01T00:00:00.000Z",
    ]);

    expect((await store.listDispatchedSends(owner, 1)).map(({ id }) => id)).toEqual([newer]);
    expect((await store.listDispatchedSends(owner, 10)).map(({ id }) => id)).toEqual([newer, older]);
  });

  test("lazy GC deletes stale drafts and lists only recent confirmed owner rows", async () => {
    const stale = randomUUID();
    const recent = randomUUID();
    await store.insert({ id: stale, owner, kind: "send", summary, pending: { calls }, createdAt: "2026-09-12T00:00:00.000Z" });
    await store.insert({ id: recent, owner, kind: "send", summary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, recent);
    const rows = await store.list(owner);
    expect(rows.map(({ id }) => id)).toEqual([recent]);
    const staleRows = await sql.query(
      "SELECT id FROM actions WHERE owner_key = $1 AND id = $2",
      [actionOwnerKey(owner), stale],
    );
    expect(staleRows.rows).toHaveLength(0);
  });

  test("confirmation records a submitted order and repeats without duplicating", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "cash-out", summary: cashoutSummary, pending: { calls }, createdAt: new Date().toISOString() });
    expect(await store.hasUnsettledCashout(owner, { amountBaseUnits: "2000000", platform: "cashapp", currency: "USD", canonicalHandle: "alice" })).toBe(false);
    await store.confirm(owner, id);
    await store.confirm(owner, id);
    const orders = await store.cashoutOrders(owner, [id]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ provider_id: "peer", region: "US", state: "submitted", amount_atomic: "2000000", remaining_atomic: "2000000" });
    expect(await store.hasUnsettledCashout(owner, { amountBaseUnits: "2000000", platform: "cashapp", currency: "USD", canonicalHandle: "alice" })).toBe(true);
    expect(await store.cashoutOrders(otherOwner, [id])).toEqual([]);
  });

  test("legacy confirmed rows are backfilled and owner-scoped progress settles without overwrites", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "cash-out", summary: { ...cashoutSummary, metadata: { ...cashoutSummary.metadata, region: undefined } }, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, id);
    await sql.query("DELETE FROM cashout_orders WHERE action_id = $1", [id]);
    const row = (await store.get(owner, id))!;
    expect(await store.ensureCashoutOrder(otherOwner, row)).toBeNull();
    expect((await store.ensureCashoutOrder(owner, row))?.region).toBe("US");
    expect(await store.linkCashoutDeposit(otherOwner, id, "deposit_7")).toBeNull();
    expect((await store.linkCashoutDeposit(owner, id, "deposit_7"))?.deposit_id).toBe("deposit_7");
    expect(await store.linkCashoutDeposit(owner, id, "deposit_8")).toBeNull();
    const progress = { state: "returned" as const, filledAtomic: "500000", returnedAtomic: "1500000", remainingAtomic: "0", withdrawable: false, settled: true };
    expect(await store.updateCashoutProgress(otherOwner, id, progress, "2026-09-12T12:00:00.000Z", null)).toBeNull();
    expect((await store.updateCashoutProgress(owner, id, progress, "2026-09-12T12:00:00.000Z", null, "deposit_7"))?.settled_at).not.toBeNull();
    expect(await store.hasUnsettledCashout(owner, { amountBaseUnits: "2000000", platform: "cashapp", currency: "USD", canonicalHandle: "alice" })).toBe(false);
    expect(await store.updateCashoutProgress(owner, id, { ...progress, state: "unknown" }, "2026-09-12T12:01:00.000Z", null, "deposit_7")).toBeNull();
    expect((await store.cashoutOrders(owner, [id]))[0]?.state).toBe("returned");
  });


  test("rejects an out-of-order provider observation before it overwrites progress", async () => {
    const id = randomUUID();
    await store.insert({ id, owner, kind: "cash-out", summary: cashoutSummary, pending: { calls }, createdAt: new Date().toISOString() });
    await store.confirm(owner, id);
    await store.ensureCashoutOrder(owner, (await store.get(owner, id))!);
    const newer = { state: "awaiting-buyer" as const, filledAtomic: "1500000", returnedAtomic: "0", remainingAtomic: "500000", withdrawable: true, settled: false };
    const older = { state: "awaiting-buyer" as const, filledAtomic: "0", returnedAtomic: "0", remainingAtomic: "2000000", withdrawable: true, settled: false };
    expect((await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:10:00.000Z", null))?.remaining_atomic).toBe("500000");
    expect(await store.updateCashoutProgress(owner, id, older, "2026-09-12T12:00:00.000Z", null)).toBeNull();
    expect((await store.cashoutOrders(owner, [id]))[0]?.remaining_atomic).toBe("500000");
    expect(await store.updateCashoutProgress(owner, id, older, "2026-09-12T12:10:00.000Z", null)).toBeNull();
    const local = { ...newer, returnedAtomic: "100000", remainingAtomic: "400000" };
    expect(await store.updateCashoutProgress(owner, id, local, null, "2026-09-12T12:10:00.000Z", null, "2020-01-01T00:00:00.000Z")).toBeNull();
    const revision = new Date((await store.cashoutOrders(owner, [id]))[0]!.updated_at).toISOString();
    expect((await store.updateCashoutProgress(owner, id, local, null, "2026-09-12T12:10:00.000Z", null, revision))?.remaining_atomic).toBe("400000");
    expect((await store.cashoutOrders(owner, [id]))[0]?.provider_updated_at).not.toBeNull();
    expect(await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:00:00.000Z", null)).toBeNull();
    expect((await store.updateCashoutProgress(owner, id, older, "2026-09-12T12:20:00.000Z", null))?.remaining_atomic).toBe("2000000");
    expect(await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:25:00.000Z", null, null, "2020-01-01T00:00:00.000Z")).toBeNull();
    const unlinkedRevision = new Date((await store.cashoutOrders(owner, [id]))[0]!.updated_at).toISOString();
    expect((await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:25:00.000Z", null, null, unlinkedRevision))?.remaining_atomic).toBe("500000");
    expect((await store.linkCashoutDeposit(owner, id, "deposit_link"))?.provider_updated_at).toBeNull();
    expect(await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:30:00.000Z", null, null)).toBeNull();
    expect((await store.updateCashoutProgress(owner, id, newer, "2026-09-12T12:30:00.000Z", null, "deposit_link"))?.remaining_atomic).toBe("500000");
  });
  test("extends cash-out and withdrawal visibility to 30 days and keeps unsettled older deposits", async () => {
    const recent = randomUUID();
    const old = randomUUID();
    const withdrawal = randomUUID();
    const send = randomUUID();
    for (const [id, kind, actionSummary] of [[recent, "cash-out", cashoutSummary], [old, "cash-out", cashoutSummary],
      [withdrawal, "cash-out-withdraw", summary], [send, "send", summary]] as const) {
      await store.insert({ id, owner, kind, summary: actionSummary, pending: { calls }, createdAt: new Date().toISOString() });
      await store.confirm(owner, id);
    }
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '10 days' WHERE id = ANY($1::uuid[])", [[recent, withdrawal, send]]);
    await sql.query("UPDATE actions SET confirmed_at = now() - interval '60 days' WHERE id = $1", [old]);
    expect((await store.list(owner)).map(({ id }) => id).sort()).toEqual([recent, withdrawal, old].sort());
    await store.updateCashoutProgress(owner, old, { state: "delivered", filledAtomic: "2000000", returnedAtomic: "0", remainingAtomic: "0", withdrawable: false, settled: true }, "2026-09-12T12:02:00.000Z", null);
    expect((await store.list(owner)).map(({ id }) => id).sort()).toEqual([recent, withdrawal].sort());
  });
});
