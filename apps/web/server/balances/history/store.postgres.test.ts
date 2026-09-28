import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { contractHistoryAsset, nativeHistoryAsset } from "./assets";
import { PostgresHistoryStore, getHistoryStore } from "./store";
import type { BalanceChange, BalanceCheckpoint, HexAddress, HistoryAddress, ValuationPoint } from "./types";

const url = process.env.BALANCES_PG_TEST_URL?.trim();
const suite = url ? describe : describe.skip;
const chainId = 8453;
const blockTime = new Date("2025-01-01T00:00:00Z");
const token = contractHistoryAsset("0x0000000000000000000000000000000000000001");
const other = contractHistoryAsset("0x0000000000000000000000000000000000000002");
let sql: SqlExecutor;
let store: PostgresHistoryStore;
let customerId: string;
let address: HexAddress;

function change(asset: typeof token, blockNumber: bigint, delta: bigint, logIndex = 0): BalanceChange {
  return { asset, blockNumber, delta, logIndex, blockTime,
    txHash: `0x${(blockNumber * BigInt(100) + BigInt(logIndex)).toString(16).padStart(64, "0")}` };
}

async function enroll(): Promise<HistoryAddress> {
  const row = await store.enroll({ chainId, address, windowStartBlock: BigInt(10), windowStartAt: blockTime, enrolledBlock: BigInt(100) });
  if (!row) throw new Error("Expected enrolled address");
  return row;
}

async function count(table: "history_addresses" | "balance_changes" | "balance_checkpoints", id: number): Promise<number> {
  const result = await sql.query<{ total: string }>(`SELECT count(*) AS total FROM ${table} WHERE ${table === "history_addresses" ? "id" : "address_id"}=$1`, [id]);
  return Number(result.rows[0]!.total);
}

suite("PostgresHistoryStore", () => {
  beforeAll(() => {
    sql = createPostgresSqlExecutor(url!);
    store = new PostgresHistoryStore(sql);
  });
  beforeEach(async () => {
    customerId = randomUUID();
    const credential = randomUUID();
    address = `0x${randomUUID().replaceAll("-", "").padStart(40, "0")}`;
    await sql.query("INSERT INTO customers (id, first_seen_at, last_seen_at, first_seen_source) VALUES ($1,$2,$2,'sign_in')", [customerId, blockTime]);
    await sql.query("INSERT INTO customer_credentials (id, customer_id, account_provider, subject, first_seen_at, last_seen_at) VALUES ($1,$2,'base-account',$3,$4,$4)",
      [credential, customerId, randomUUID(), blockTime]);
    await sql.query("INSERT INTO customer_wallets (id, customer_id, credential_id, chain_id, address) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), customerId, credential, chainId, address]);
  });
  afterEach(async () => { await sql.query("DELETE FROM customers WHERE id=$1", [customerId]); });
  afterAll(async () => { await sql?.dispose?.(); });

  test("enroll only wallets, case-folds, and preserves the first enrollment", async () => {
    if (!process.env.DATABASE_URL?.trim()) expect(getHistoryStore()).toBeNull();
    expect(await store.enroll({ chainId, address: `0x${"f".repeat(40)}`, windowStartBlock: BigInt(10), windowStartAt: blockTime, enrolledBlock: BigInt(100) })).toBeNull();
    const first = await store.enroll({ chainId, address: address.toUpperCase().replace("0X", "0x") as HexAddress,
      windowStartBlock: BigInt(10), windowStartAt: blockTime, enrolledBlock: BigInt(100) });
    expect(first?.address).toBe(address);
    expect(first?.backfillBlock).toBe(BigInt(100));
    expect(first?.forwardBlock).toBe(BigInt(100));
    expect(await store.enroll({ chainId, address, windowStartBlock: BigInt(99), windowStartAt: blockTime, enrolledBlock: BigInt(200) })).toEqual(first);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("markDirty changes only enrolled addresses and never regresses", async () => {
    expect(await store.markDirty(chainId, [], blockTime)).toBe(0);
    expect(await store.markDirty(chainId, [address], blockTime)).toBe(0);
    const row = await enroll();
    const later = new Date(blockTime.getTime() + 1000);
    expect(await store.markDirty(chainId, [address, `0x${"f".repeat(40)}`], later)).toBe(1);
    expect(await store.markDirty(chainId, [address], blockTime)).toBe(1);
    expect((await store.getAddress(chainId, address))?.dirtyAt).toEqual(later);
    expect(await count("history_addresses", row.id)).toBe(1);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("backfill retry conflicts, duplicate rows stay absent, and invalid chunks roll back", async () => {
    const row = await enroll();
    const changes = [change(token, BigInt(99), BigInt("123456789012345678901234567890")), change(token, BigInt(100), BigInt(0), 1)];
    const commit = { addressId: row.id, expectedBackfillBlock: BigInt(100), nextBackfillBlock: BigInt(90), changes };
    expect(await store.commitBackfillChunk(commit)).toBe("committed");
    expect(await store.commitBackfillChunk(commit)).toBe("conflict");
    expect(await count("balance_changes", row.id)).toBe(2);
    await expect(store.commitBackfillChunk({ ...commit, expectedBackfillBlock: BigInt(90), nextBackfillBlock: BigInt(80), changes: [change(token, BigInt(80), BigInt(1))] })).rejects.toThrow("Invalid backfill chunk range");
    expect((await store.getAddress(chainId, address))?.backfillBlock).toBe(BigInt(90));
    expect(await count("balance_changes", row.id)).toBe(2);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("replay invalidates only inserted assets while retaining chain pins and unchanged comparisons", async () => {
    const row = await enroll();
    const point = (asset: typeof token, blockNumber: bigint, chainQuantity: bigint, logQuantity: bigint): BalanceCheckpoint =>
      ({ asset, blockNumber, purpose: "reconcile", chainQuantity, logQuantity, observedAt: blockTime });
    await store.putCheckpoints(row.id, [point(token, BigInt(50), BigInt(5), BigInt(5)),
      point(token, BigInt(99), BigInt(9), BigInt(9)), point(other, BigInt(90), BigInt(11), BigInt(2))]);
    await store.commitBackfillChunk({ addressId: row.id, expectedBackfillBlock: BigInt(100), nextBackfillBlock: BigInt(90),
      changes: [change(other, BigInt(95), BigInt(7))] });
    const replay = { addressId: row.id, changes: [change(token, BigInt(95), BigInt(4)), change(other, BigInt(95), BigInt(7))],
      invalidateAboveBlock: BigInt(40) };
    expect(await store.appendReplayChanges(replay)).toBe(1);
    const points = await store.listCheckpoints(row.id);
    expect(points.map((entry) => [entry.asset.key, entry.blockNumber, entry.chainQuantity, entry.logQuantity])).toEqual([
      [token.key, BigInt(50), BigInt(5), null],
      [token.key, BigInt(99), BigInt(9), null],
      [other.key, BigInt(90), BigInt(11), BigInt(2)],
    ]);
    await store.putCheckpoints(row.id, [point(token, BigInt(50), BigInt(99), BigInt(6)),
      point(token, BigInt(99), BigInt(99), BigInt(13))]);
    const repaired = await store.listCheckpoints(row.id);
    expect(repaired.map((entry) => [entry.asset.key, entry.blockNumber, entry.chainQuantity, entry.logQuantity])).toEqual([
      [token.key, BigInt(50), BigInt(5), BigInt(6)],
      [token.key, BigInt(99), BigInt(9), BigInt(13)],
      [other.key, BigInt(90), BigInt(11), BigInt(2)],
    ]);
    expect(await store.appendReplayChanges(replay)).toBe(0);
    expect(await store.listCheckpoints(row.id)).toEqual(repaired);
    expect(await count("balance_changes", row.id)).toBe(2);
    expect((await store.getAddress(chainId, address))?.backfillBlock).toBe(BigInt(90));
    expect((await store.getAddress(chainId, address))?.forwardBlock).toBe(BigInt(100));
  });

  test("replay insert and comparison invalidation roll back together on failure", async () => {
    const row = await enroll();
    await store.putCheckpoints(row.id, [{ asset: token, blockNumber: BigInt(99), purpose: "reconcile",
      chainQuantity: BigInt(9), logQuantity: BigInt(9), observedAt: blockTime }]);
    const failing = new PostgresHistoryStore({ ...sql, transaction: (fn) => sql.transaction((tx) => fn({ ...tx,
      query: async <T = Record<string, unknown>>(...args: Parameters<SqlExecutor["query"]>) => {
        if (args[0].startsWith("UPDATE balance_checkpoints SET log_quantity=NULL")) throw new Error("invalidation failed");
        return tx.query<T>(...args);
      },
    })) });
    const replay = { addressId: row.id, changes: [change(token, BigInt(95), BigInt(4))], invalidateAboveBlock: BigInt(90) };
    await expect(failing.appendReplayChanges(replay)).rejects.toThrow("invalidation failed");
    expect(await count("balance_changes", row.id)).toBe(0);
    expect((await store.listCheckpoints(row.id)).map((point) => [point.chainQuantity, point.logQuantity]))
      .toEqual([[BigInt(9), BigInt(9)]]);
    expect(await store.appendReplayChanges(replay)).toBe(1);
    expect((await store.listCheckpoints(row.id)).map((point) => [point.chainQuantity, point.logQuantity]))
      .toEqual([[BigInt(9), null]]);
  });

  test("pending reconcile accepts a null comparison, but every checkpoint requires a chain pin", async () => {
    const row = await enroll();
    await store.putCheckpoints(row.id, [{ asset: token, blockNumber: BigInt(50), purpose: "reconcile",
      chainQuantity: BigInt(7), logQuantity: null, observedAt: blockTime }]);
    expect((await store.listCheckpoints(row.id))[0]).toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(7), logQuantity: null });
    await store.putCheckpoints(row.id, [{ asset: token, blockNumber: BigInt(50), purpose: "reconcile",
      chainQuantity: BigInt(99), logQuantity: BigInt(7), observedAt: blockTime }]);
    expect((await store.listCheckpoints(row.id))[0]).toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(7), logQuantity: BigInt(7) });
    const asset = await sql.query<{ id: number }>("SELECT id FROM history_assets WHERE chain_id=$1 AND asset_key=$2", [chainId, token.key]);
    for (const purpose of ["window-start", "bucket"] as const) {
      await expect(sql.query(`INSERT INTO balance_checkpoints
        (address_id, asset_id, block_number, purpose, chain_quantity, log_quantity, observed_at) VALUES ($1,$2,$3,$4,NULL,NULL,$5)`,
      [row.id, asset.rows[0]!.id, purpose === "bucket" ? "60" : "70", purpose, blockTime])).rejects.toMatchObject({ code: "23502" });
    }
  });

  test("a canonical kind change rewrites the stored asset metadata without touching its changes", async () => {
    const row = await enroll();
    expect(await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(110),
      changes: [change(token, BigInt(105), BigInt(7))], ingestedAt: blockTime, clearDirtyObservedBefore: null })).toBe("committed");
    const promoted = { ...token, kind: "vault-share" as const };
    expect(await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(120),
      changes: [change(promoted, BigInt(115), BigInt(3))], ingestedAt: blockTime, clearDirtyObservedBefore: null })).toBe("committed");
    expect((await store.listTrackedAssets(row.id)).map((asset) => asset.kind)).toEqual(["vault-share"]);
    const assets = await sql.query<{ total: string }>("SELECT count(*) AS total FROM history_assets WHERE asset_key=$1", [token.key]);
    expect(Number(assets.rows[0]!.total)).toBe(1);
    expect(await count("balance_changes", row.id)).toBe(2);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("verified decimals and cash denomination persist and are never overwritten", async () => {
    const row = await enroll();
    const verified = contractHistoryAsset("0x00000000000000000000000000000000000000aa", { decimals: 6, cashCurrency: "EUR" });
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(110),
      changes: [change(verified, BigInt(105), BigInt(7))], ingestedAt: blockTime, clearDirtyObservedBefore: null });
    expect(await store.listTrackedAssets(row.id)).toEqual([verified]);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(120),
      changes: [change(contractHistoryAsset("0x00000000000000000000000000000000000000aa", { decimals: 18, cashCurrency: "USD" }), BigInt(115), BigInt(3))], ingestedAt: blockTime, clearDirtyObservedBefore: null });
    expect(await store.listTrackedAssets(row.id)).toEqual([verified]);
  });

  test("putAssets records verified metadata with no change or checkpoint", async () => {
    const verified = contractHistoryAsset("0x00000000000000000000000000000000000000bb", { decimals: 6, cashCurrency: "IDR" });
    await store.putAssets(chainId, [verified]);
    const stored = await sql.query<{ kind: string; decimals: number; cash_currency: string }>("SELECT kind, decimals, cash_currency FROM history_assets WHERE asset_key=$1", [verified.key]);
    expect(stored.rows[0]).toEqual({ kind: "erc20", decimals: 6, cash_currency: "IDR" });
    await store.putAssets(chainId, [{ ...verified, decimals: 18, cashCurrency: "USD" }]);
    const kept = await sql.query<{ decimals: number; cash_currency: string }>("SELECT decimals, cash_currency FROM history_assets WHERE asset_key=$1", [verified.key]);
    expect(kept.rows[0]).toEqual({ decimals: 6, cash_currency: "IDR" });
  });

  test("concurrent backfill and forward both commit; competing forward commits have one winner", async () => {
    const row = await enroll();
    const backward = change(token, BigInt(95), BigInt(-7));
    const forward = change(token, BigInt(105), BigInt(9));
    expect(await Promise.all([
      store.commitBackfillChunk({ addressId: row.id, expectedBackfillBlock: BigInt(100), nextBackfillBlock: BigInt(90), changes: [backward] }),
      store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(110),
        changes: [forward], ingestedAt: blockTime, clearDirtyObservedBefore: null }),
    ])).toEqual(["committed", "committed"]);
    const forwardInput = { addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(120),
      changes: [change(token, BigInt(115), BigInt(3))], ingestedAt: blockTime, clearDirtyObservedBefore: null };
    expect((await Promise.all([store.commitForwardChunk(forwardInput), store.commitForwardChunk(forwardInput)])).sort()).toEqual(["committed", "conflict"]);
    expect(await count("balance_changes", row.id)).toBe(3);
    expect((await store.getAddress(chainId, address))?.forwardBlock).toBe(BigInt(120));
    expect((await store.sumChanges({ addressId: row.id, fromBlockExclusive: BigInt(90), boundaries: [BigInt(100), BigInt(120)] }))[0]?.sums).toEqual([BigInt(-7), BigInt(5)]);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("forward rejects out-of-range rows and clears only observed dirty state", async () => {
    const row = await enroll();
    await store.markDirty(chainId, [address], blockTime);
    await expect(store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(110),
      changes: [change(token, BigInt(100), BigInt(1))], ingestedAt: blockTime, clearDirtyObservedBefore: blockTime })).rejects.toThrow("Invalid forward chunk range");
    expect((await store.getAddress(chainId, address))?.forwardBlock).toBe(BigInt(100));
    expect(await count("balance_changes", row.id)).toBe(0);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(110),
      changes: [], ingestedAt: blockTime, clearDirtyObservedBefore: new Date(blockTime.getTime() - 1000) });
    expect((await store.getAddress(chainId, address))?.dirtyAt).toEqual(blockTime);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(120),
      changes: [], ingestedAt: blockTime, clearDirtyObservedBefore: blockTime });
    expect((await store.getAddress(chainId, address))?.dirtyAt).toBeNull();
    expect((await store.getAddress(chainId, address))?.ingestedAt).toEqual(blockTime);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });

  test("checkpoints keep first chain quantity, coalesce log and promote purpose; assets track both sources", async () => {
    const row = await enroll();
    const point = (purpose: BalanceCheckpoint["purpose"], chainQuantity: bigint, logQuantity: bigint | null): BalanceCheckpoint =>
      ({ asset: token, blockNumber: BigInt(50), purpose, chainQuantity, logQuantity, observedAt: blockTime });
    await store.putCheckpoints(row.id, [point("bucket", BigInt(11), null), { ...point("window-start", BigInt(999), null), asset: nativeHistoryAsset() }]);
    await store.putCheckpoints(row.id, [point("window-start", BigInt(22), null), point("reconcile", BigInt(33), BigInt(12)), point("bucket", BigInt(44), BigInt(99))]);
    const checkpoints = await store.listCheckpoints(row.id);
    expect(checkpoints.find((c) => c.asset.key === token.key)).toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(11), logQuantity: BigInt(12) });
    expect((await store.listTrackedAssets(row.id)).map((asset) => asset.key)).toEqual([token.key, nativeHistoryAsset().key].sort());
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
    expect(await count("history_addresses", row.id)).toBe(0);
    expect(await count("balance_checkpoints", row.id)).toBe(0);
  });

  test("sumChanges accumulates per boundary and counts only balance-changing deltas for promotion", async () => {
    const row = await enroll();
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(100), nextForwardBlock: BigInt(140),
      changes: [change(token, BigInt(101), BigInt("100000000000000000000000000000")), change(token, BigInt(110), BigInt(0)),
        change(token, BigInt(130), BigInt(-3)), change(other, BigInt(110), BigInt(7), 1)], ingestedAt: blockTime, clearDirtyObservedBefore: null });
    const sums = await store.sumChanges({ addressId: row.id, fromBlockExclusive: BigInt(100), boundaries: [BigInt(105), BigInt(110), BigInt(120), BigInt(140)] });
    expect(sums.find((item) => item.asset.key === token.key)).toMatchObject({
      sums: [BigInt("100000000000000000000000000000"), BigInt("100000000000000000000000000000"),
        BigInt("100000000000000000000000000000"), BigInt("99999999999999999999999999997")], counts: [1, 1, 1, 2],
    });
    expect(sums.find((item) => item.asset.key === other.key)).toMatchObject({ sums: [BigInt(0), BigInt(7), BigInt(7), BigInt(7)], counts: [0, 1, 1, 1] });
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
    expect(await count("balance_changes", row.id)).toBe(0);
  });

  test("buckets and settled valuation misses stay immutable; pruning is bounded and hourly only", async () => {
    const bucketAt = new Date("2025-01-02T00:00:00Z");
    const bucket = { bucketAt, blockNumber: BigInt(200), blockHash: `0x${"a".repeat(64)}` as const, blockTime };
    await store.putBuckets(chainId, [bucket]);
    await store.putBuckets(chainId, [{ ...bucket, blockNumber: BigInt(201) }]);
    expect((await store.getBuckets(chainId, [bucketAt]))[0]).toEqual(bucket);
    const seriesKey = `test:${randomUUID()}`;
    const point: ValuationPoint = { seriesKey, basisVersion: "history-basis-v1", granularity: "1h", bucketAt,
      value: null, blockNumber: null, source: "test", observedAt: blockTime };
    await store.putValuationPoints([point, { ...point, bucketAt: new Date(bucketAt.getTime() + 3600000), value: { atoms: BigInt("999999999999999999999"), scale: 18 } },
      { ...point, granularity: "1d" }]);
    await store.putValuationPoints([{ ...point, value: { atoms: BigInt(1), scale: 0 } }]);
    expect((await store.getValuationPoints({ seriesKeys: [seriesKey], basisVersion: point.basisVersion, granularity: "1h", bucketTimes: [bucketAt] }))[0]?.value).toBeNull();
    expect(await store.pruneHourlyValuationPoints(new Date(bucketAt.getTime() + 86400000), 1)).toBe(1);
    const remaining = await store.getValuationPoints({ seriesKeys: [seriesKey], basisVersion: point.basisVersion,
      granularity: "1h", bucketTimes: [bucketAt, new Date(bucketAt.getTime() + 3600000)] });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.value?.atoms).toBe(BigInt("999999999999999999999"));
    expect(await store.getValuationPoints({ seriesKeys: [seriesKey], basisVersion: point.basisVersion, granularity: "1d", bucketTimes: [bucketAt] })).toHaveLength(1);
    await sql.query("DELETE FROM valuation_points WHERE series_key=$1", [seriesKey]);
    await sql.query("DELETE FROM chain_buckets WHERE chain_id=$1 AND bucket_at=$2", [chainId, bucketAt]);
    await sql.query("DELETE FROM customers WHERE id=$1", [customerId]);
  });
});
