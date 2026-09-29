import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresBalanceSnapshotStore } from "@/server/balances/snapshot-store";
import { portfolioVaults } from "@/config/portfolio-assets";
import { erc20AssetKey } from "@/shared/balances/types";
import { createPostgresSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import { contractHistoryAsset, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { createHistoryIngest } from "./ingest";
import { historyInventoryFromSnapshot } from "./reconcile";
import { PostgresHistoryStore } from "./store";
import type { BalanceChange, HexAddress, HistoryAsset, HistoryChainReader, HistoryTransferSource } from "./types";

const url = process.env.BALANCES_PG_TEST_URL?.trim();
const suite = url ? describe : describe.skip;
const time = new Date("2026-09-25T12:00:00Z");
const at = (block: bigint) => new Date(time.getTime() + Number(block - BigInt(100)) * 2000);
const hash = `0x${"a".repeat(64)}` as const;
const token = contractHistoryAsset("0x0000000000000000000000000000000000000088");
const unknown = contractHistoryAsset("0x0000000000000000000000000000000000000099");
const windowAt = new Date("2025-09-25T00:00:00Z");
let sql: SqlExecutor;
let store: PostgresHistoryStore;
let customer: string;
let address: HexAddress;
let head: bigint;
let changes: BalanceChange[];
let queries: Array<{ from: bigint; to: bigint }>;
let reads: bigint[];
let requested: string[][];
let quantity: (block: bigint, key: string) => bigint | null;
let source: HistoryTransferSource;
let chain: HistoryChainReader;

function makeChange(block: number, delta: number, asset = token): BalanceChange {
  return { asset, blockNumber: BigInt(block), delta: BigInt(delta), logIndex: 0, blockTime: at(BigInt(block)), txHash: hash };
}
function ingest() { return createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(0) }); }
function run(heldAssets: HistoryAsset[] = [token], deadline = time.getTime() + 100_000) {
  return ingest().run(address, { heldAssets, deadline });
}
async function count(table: "history_addresses" | "balance_changes" | "balance_checkpoints", id: number) {
  const result = await sql.query<{ total: string }>(`SELECT count(*) AS total FROM ${table} WHERE ${table === "history_addresses" ? "id" : "address_id"}=$1`, [id]);
  return Number(result.rows[0]!.total);
}

type BunSqlClient = {
  unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>;
  begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

function bunExecutor(client: BunSqlClient, onQuery: (text: string) => void, inTransaction = false): SqlExecutor {
  return {
    async query<T>(text: string, values: unknown[] = []) {
      onQuery(text);
      const rows = Array.from(await client.unsafe(text, values)) as T[];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>) {
      if (inTransaction) throw new Error("Nested transaction unsupported");
      return client.begin((transaction) => run(bunExecutor(transaction, onQuery, true)));
    },
  };
}

suite("history ingest with Postgres", () => {
  beforeAll(() => { sql = createPostgresSqlExecutor(url!); store = new PostgresHistoryStore(sql); });
  beforeEach(async () => {
    customer = randomUUID();
    const credential = randomUUID();
    address = `0x${randomUUID().replaceAll("-", "").padStart(40, "0")}`;
    head = BigInt(110);
    changes = [makeChange(95, 5), makeChange(105, 7)];
    queries = [];
    reads = [];
    requested = [];
    quantity = (block, key) => key === token.key ? block === BigInt(10) ? BigInt(3) : BigInt(15) : BigInt(0);
    source = { async listChanges({ fromBlockExclusive, toBlockInclusive }) {
      queries.push({ from: fromBlockExclusive, to: toBlockInclusive });
      return { changes: changes.filter((change) => change.blockNumber > fromBlockExclusive && change.blockNumber <= toBlockInclusive), queries: 1, windows: 1 };
    } };
    chain = {
      async finalizedHead() { return { number: head, hash, timestamp: Math.floor(at(head).getTime() / 1000) }; },
      async resolveBuckets(times) { return times.map((bucketAt) => ({ bucketAt, blockNumber: BigInt(10), blockHash: hash, blockTime: bucketAt })); },
      async readQuantities({ assets, block }) {
        reads.push(block);
        requested.push(assets.map((asset) => asset.key));
        return new Map(assets.map((asset) => {
          const value = quantity(block, asset.key);
          return [asset.key, value === null ? { status: "unavailable" as const } : { status: "ready" as const, baseUnits: value }] as const;
        }));
      },
      async readVaultRates() { return []; },
      async readMorphoBorrowIndexes() { return []; },
    };
    await sql.query("INSERT INTO customers (id, first_seen_at, last_seen_at, first_seen_source) VALUES ($1,$2,$2,'sign_in')", [customer, time]);
    await sql.query("INSERT INTO customer_credentials (id, customer_id, account_provider, subject, first_seen_at, last_seen_at) VALUES ($1,$2,'base-account',$3,$4,$4)",
      [credential, customer, randomUUID(), time]);
    await sql.query("INSERT INTO customer_wallets (id, customer_id, credential_id, chain_id, address) VALUES ($1,$2,$3,8453,$4)",
      [randomUUID(), customer, credential, address]);
  });
  afterEach(async () => { await sql.query("DELETE FROM customers WHERE id=$1", [customer]); });
  afterAll(async () => { await sql?.dispose?.(); });

  test("non-wallet enrollment is null and unenrolled run does not ingest", async () => {
    expect(await ingest().enroll(`0x${"f".repeat(40)}`)).toBeNull();
    expect(await run()).toEqual({ status: "not-enrolled", backfillComplete: false, queries: 0, reads: 0, windows: 0, conflicts: 0 });
  });

  test("enrollment rounds to the UTC day, remains idempotent, and full ingest is exact and idempotent", async () => {
    const enrolled = (await ingest().enroll(address))!;
    expect(enrolled.windowStartAt).toEqual(windowAt);
    expect(enrolled.windowStartBlock).toBe(BigInt(10));
    head = BigInt(120);
    expect(await ingest().enroll(address)).toEqual(enrolled);
    const first = await run();
    expect(first).toEqual({ status: "ready", backfillComplete: true, queries: 2, reads: 2, windows: 2, conflicts: 0 });
    expect(queries).toEqual([{ from: BigInt(10), to: BigInt(110) }, { from: BigInt(110), to: BigInt(120) }]);
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(120));
    const points = (await store.listCheckpoints(enrolled.id)).filter((point) => point.asset.key === token.key);
    expect(points.map((point) => [point.blockNumber, point.purpose, point.chainQuantity, point.logQuantity])).toEqual([
      [BigInt(10), "window-start", BigInt(3), null], [BigInt(120), "reconcile", BigInt(15), BigInt(15)],
    ]);
    expect(await count("balance_changes", enrolled.id)).toBe(2);
    expect(await run()).toEqual({ status: "ready", backfillComplete: true, queries: 0, reads: 0, windows: 0, conflicts: 0 });
    expect(await count("balance_changes", enrolled.id)).toBe(2);
    expect(await count("balance_checkpoints", enrolled.id)).toBeGreaterThan(2);
    await sql.query("DELETE FROM customers WHERE id=$1", [customer]);
    expect(await count("history_addresses", enrolled.id)).toBe(0);
    expect(await count("balance_changes", enrolled.id)).toBe(0);
    expect(await count("balance_checkpoints", enrolled.id)).toBe(0);
  });

  test("concurrent runs use cursor CAS and do not duplicate changes", async () => {
    const row = (await ingest().enroll(address))!;
    const results = await Promise.all([run(), run()]);
    expect(results.every((result) => result.status === "ready")).toBe(true);
    expect(await count("balance_changes", row.id)).toBe(2);
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(10));
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
  });

  test("a partial concurrent backfill commit is re-read and completed", async () => {
    const row = (await ingest().enroll(address))!;
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const original = source;
    let blocked = false;
    source = { async listChanges(input) {
      if (!blocked) { blocked = true; reached(); await gate; }
      return original.listChanges(input);
    } };
    const pending = run();
    await entered;
    expect(await store.commitBackfillChunk({ addressId: row.id, expectedBackfillBlock: BigInt(110),
      nextBackfillBlock: BigInt(50), changes: changes })).toBe("committed");
    release();
    const result = await pending;
    expect(result).toMatchObject({ status: "ready", backfillComplete: true, conflicts: 1 });
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(10));
    expect(await count("balance_changes", row.id)).toBe(2);
  });

  test("backfill and forward interleave with disjoint rows", async () => {
    const row = (await ingest().enroll(address))!;
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const original = source;
    let blocked = false;
    source = { async listChanges(input) {
      if (!blocked && input.toBlockInclusive === BigInt(110)) { blocked = true; reached(); await gate; }
      return original.listChanges(input);
    } };
    const slow = run();
    await entered;
    const fast = await run();
    expect(fast.status).toBe("ready");
    release();
    expect((await slow).status).toBe("ready");
    expect(await count("balance_changes", row.id)).toBe(2);
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
  });

  test("commits long backfill in backward chunks and resumes at the committed cursor after a deadline", async () => {
    const chunk = BigInt(31 * 43_200);
    head = BigInt(10) + chunk + BigInt(20);
    changes = [makeChange(15, 5), makeChange(Number(head - chunk), 4), makeChange(Number(head) - 1, 7)];
    const row = (await ingest().enroll(address))!;
    let nowMs = time.getTime();
    const original = source;
    source = { async listChanges(input) {
      const result = await original.listChanges(input);
      nowMs += 2_000;
      return result;
    } };
    const first = await createHistoryIngest({ store, source, chain, now: () => new Date(nowMs), lagBlocks: BigInt(0), replayBlocks: BigInt(0) })
      .run(address, { heldAssets: [token], deadline: time.getTime() + 3_000 });
    const cursor = head - chunk;
    expect(first).toMatchObject({ status: "building", backfillComplete: false, queries: 1, windows: 1 });
    expect(queries).toEqual([{ from: cursor, to: head }]);
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(cursor);
    expect(await count("balance_changes", row.id)).toBe(1);
    source = original;
    const resumed = await run();
    expect(resumed).toMatchObject({ status: "ready", backfillComplete: true, queries: 1, windows: 1 });
    expect(queries).toEqual([{ from: cursor, to: head }, { from: BigInt(10), to: cursor }]);
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(10));
    expect(await count("balance_changes", row.id)).toBe(3);
    expect((await sql.query<{ block_number: string }>("SELECT block_number FROM balance_changes WHERE address_id=$1 ORDER BY block_number", [row.id]))
      .rows.map(({ block_number }) => BigInt(block_number))).toEqual([BigInt(15), cursor, head - BigInt(1)]);
    expect((await run()).queries).toBe(0);
    expect(await count("balance_changes", row.id)).toBe(3);
  });

  test("deadline stops between commits and a following run resumes", async () => {
    const row = (await ingest().enroll(address))!;
    head = BigInt(120);
    changes.push(makeChange(115, 4));
    let current = time.getTime();
    const clock = () => new Date(current += 300);
    const coordinator = createHistoryIngest({ store, source, chain, now: clock, lagBlocks: BigInt(0), replayBlocks: BigInt(0) });
    const first = await coordinator.run(address, { heldAssets: [token], deadline: time.getTime() + 1800 });
    expect(first.status).toBe("building");
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(10));
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
    expect(await count("balance_changes", row.id)).toBe(2);
    expect((await run()).status).toBe("ready");
  });

  test("completed backfill is still building when the forward cursor trails this run's head", async () => {
    const row = (await ingest().enroll(address))!;
    expect((await run()).status).toBe("ready");
    head = BigInt(120);
    let current = time.getTime();
    const coordinator = createHistoryIngest({ store, source, chain, now: () => new Date(current += 300), lagBlocks: BigInt(0), replayBlocks: BigInt(0) });
    expect(await coordinator.run(address, { heldAssets: [token], deadline: time.getTime() + 1_300 })).toEqual(
      { status: "building", backfillComplete: true, queries: 0, reads: 0, windows: 0, conflicts: 0 });
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
    expect(await count("balance_changes", row.id)).toBe(2);
    expect((await run()).status).toBe("ready");
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(120));
  });

  test("unavailable anchor remains building and is retried without a false zero", async () => {
    const row = (await ingest().enroll(address))!;
    const original = quantity;
    quantity = (block, key) => block === BigInt(10) && key === token.key ? null : original(block, key);
    expect((await run()).status).toBe("building");
    expect((await store.listCheckpoints(row.id)).some((point) => point.asset.key === token.key && point.purpose === "window-start")).toBe(false);
    quantity = original;
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).find((point) => point.asset.key === token.key && point.purpose === "window-start")?.chainQuantity).toBe(BigInt(3));
  });

  test("an unavailable initial comparison keeps the run building and the asset pending", async () => {
    const row = (await ingest().enroll(address))!;
    const original = quantity;
    quantity = (block, key) => block === BigInt(110) ? null : original(block, key);
    expect((await run()).status).toBe("building");
    expect((await store.listCheckpoints(row.id)).some((point) =>
      point.blockNumber > row.windowStartBlock && point.purpose === "reconcile")).toBe(false);
    quantity = original;
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).some((point) =>
      point.blockNumber === BigInt(110) && point.purpose === "reconcile")).toBe(true);
  });

  test("a pending replayed comparison keeps the run building until it is repaired", async () => {
    const row = (await ingest().enroll(address))!;
    expect((await run()).status).toBe("ready");
    head = BigInt(110 + 30 * 86_400 / 2);
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile")
      .map((point) => point.logQuantity)).toEqual([BigInt(15), BigInt(15)]);
    expect(await store.appendReplayChanges({ addressId: row.id, changes: [makeChange(1_000_001, 4)], invalidateAboveBlock: BigInt(1_000_000) })).toBe(1);
    head += BigInt(100);
    const original = quantity;
    quantity = (block, key) => key === token.key && block === head ? null : original(block, key);
    expect((await run()).status).toBe("building");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile")
      .map((point) => point.logQuantity)).toEqual([BigInt(15), null]);
    quantity = original;
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile")
      .map((point) => point.logQuantity)).toEqual([BigInt(15), BigInt(19), BigInt(19)]);
  });

  test("source failure leaves cursor unchanged and reports building, then retries", async () => {
    const row = (await ingest().enroll(address))!;
    source = { async listChanges() { throw new Error("source unavailable"); } };
    expect((await run()).status).toBe("building");
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(110));
    expect(await count("balance_changes", row.id)).toBe(0);
  });

  test("a real short deadline aborts a pending source call without advancing cursors or writing rows", async () => {
    const row = (await ingest().enroll(address))!;
    let entered = false;
    source = { async listChanges({ signal }) {
      entered = true;
      return await new Promise<never>((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } };
    const result = await createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(0) }).run(address,
      { heldAssets: [token], deadline: time.getTime() + 20 });
    expect(entered).toBe(true);
    expect(result).toMatchObject({ status: "building", queries: 0, windows: 0 });
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(110));
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
    expect(await count("balance_changes", row.id)).toBe(0);
    expect(await count("balance_checkpoints", row.id)).toBe(0);
  });

  test("forward ingest keeps the index-lag window uncommitted until its watermark advances", async () => {
    const lagged = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(5), replayBlocks: BigInt(0) });
    const enrolled = (await lagged.enroll(address))!;
    expect(enrolled.enrolledBlock).toBe(BigInt(105));
    expect((await lagged.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 })).status).toBe("ready");
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(105));
    head = BigInt(115);
    changes.push(makeChange(115, 4));
    queries = [];
    await lagged.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 });
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
    expect(queries).toEqual([{ from: BigInt(105), to: BigInt(110) }]);
    head = BigInt(120);
    queries = [];
    await lagged.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 });
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(115));
    expect(queries).toEqual([{ from: BigInt(110), to: BigInt(115) }]);
    expect(await count("balance_changes", enrolled.id)).toBe(3);
  });

  test("a replay clears and repairs pinned comparisons so a mismatch is never ready", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(120);
    await run();
    const before = (await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile");
    expect(before.map((point) => [point.blockNumber, point.logQuantity])).toEqual([[BigInt(110), BigInt(15)]]);
    changes.push(makeChange(108, 4));
    head = BigInt(130);
    const replay = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(40) });
    await replay.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 });
    const after = (await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile");
    expect(after.map((point) => [point.blockNumber, point.chainQuantity, point.logQuantity])).toEqual([
      [BigInt(110), BigInt(15), BigInt(19)], [BigInt(130), BigInt(15), BigInt(19)],
    ]);
    const bucketAt = at(BigInt(125));
    const read = await ingest().readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(125), blockHash: hash, blockTime: bucketAt }],
      heldAssets: [], maxArchiveReads: 0 });
    expect(read.find((entry) => entry.asset.key === token.key)?.segments.map((segment) => segment.method)).toEqual(["archive-read"]);
    expect(read.find((entry) => entry.asset.key === token.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(125), status: "unavailable", reason: "pending-read" });
  });

  test("a completed replay makes history reads pending while two prior reads stay stable", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(120);
    await run();
    const bucketAt = at(BigInt(115));
    const bucket = { bucketAt, blockNumber: BigInt(115), blockHash: hash, blockTime: bucketAt };
    const first = (await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === token.key)!;
    const second = (await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === token.key)!;
    expect(first.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(15) });
    expect(second.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(15) });
    expect(second.segments).toEqual([
      { fromBlock: BigInt(10), toBlock: BigInt(110), method: "archive-read" },
      { fromBlock: BigInt(110), toBlock: null, method: "transfer-log" },
    ]);
    expect(await store.appendReplayChanges({ addressId: row.id, changes: [makeChange(108, 4)],
      invalidateAboveBlock: BigInt(100) })).toBe(1);
    const pending = (await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === token.key)!;
    expect(pending.segments).toEqual([{ fromBlock: BigInt(10), toBlock: null, method: "archive-read" }]);
    expect(pending.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(115), status: "unavailable", reason: "pending-read" });
  });

  test("a read waits for the replay address lock and sees its committed invalidation", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(120);
    await run();
    const bucketAt = at(BigInt(115));
    const bucket = { bucketAt, blockNumber: BigInt(115), blockHash: hash, blockTime: bucketAt };
    const writer = new Bun.SQL(url!) as unknown as BunSqlClient;
    const reader = new Bun.SQL(url!) as unknown as BunSqlClient;
    let lockAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => { lockAttempted = resolve; });
    const readingStore = new PostgresHistoryStore(bunExecutor(reader, (text) => {
      if (text.includes("history_addresses WHERE id=$1 FOR SHARE")) lockAttempted();
    }));
    let reading!: ReturnType<ReturnType<typeof ingest>["readQuantities"]>;
    try {
      await writer.begin(async (tx) => {
        await tx.unsafe("SELECT id FROM history_addresses WHERE id=$1 FOR UPDATE", [row.id]);
        await tx.unsafe(`INSERT INTO balance_changes (address_id, asset_id, block_number, log_index, block_time, tx_hash, delta, source)
          SELECT $1, id, $2, 0, $3, decode($4, 'hex'), $5, 'cdp-sql-transfer' FROM history_assets WHERE asset_key=$6`,
        [row.id, "108", at(BigInt(108)), hash.slice(2), "4", token.key]);
        await tx.unsafe(`UPDATE balance_checkpoints SET log_quantity=NULL
          WHERE address_id=$1 AND purpose='reconcile' AND block_number > $2
            AND asset_id=(SELECT id FROM history_assets WHERE asset_key=$3)`, [row.id, "100", token.key]);
        reading = createHistoryIngest({ store: readingStore, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(0) })
          .readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 });
        const timeout = AbortSignal.timeout(500);
        const timedOut = new Promise<"timed-out">((resolve) => {
          timeout.addEventListener("abort", () => resolve("timed-out"), { once: true });
        });
        expect(await Promise.race([attempted.then(() => "lock-requested"), timedOut])).toBe("lock-requested");
        const settleTimeout = AbortSignal.timeout(5);
        const blocked = new Promise<"blocked">((resolve) => {
          settleTimeout.addEventListener("abort", () => resolve("blocked"), { once: true });
        });
        expect(await Promise.race([reading.then(() => "resolved"), blocked])).toBe("blocked");
      });
      expect((await store.listCheckpoints(row.id)).find((point) => point.asset.key === token.key && point.blockNumber === BigInt(110))
        ?.logQuantity).toBeNull();
      const pending = (await reading).find((entry) => entry.asset.key === token.key)!;
      expect(pending.segments).toEqual([{ fromBlock: BigInt(10), toBlock: null, method: "archive-read" }]);
      expect(pending.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(115), status: "unavailable", reason: "pending-read" });
    } finally {
      await reader.close();
      await writer.close();
    }
  });

  test("pending replay comparison is due immediately, preserves its chain pin, and resumes logs after matching repair", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    const delayed = [makeChange(107, 4), makeChange(108, -4)];
    expect(await store.appendReplayChanges({ addressId: row.id, changes: delayed, invalidateAboveBlock: BigInt(100) })).toBe(2);
    const pending = (await store.listCheckpoints(row.id)).find((point) => point.asset.key === token.key && point.blockNumber === BigInt(110));
    expect(pending).toMatchObject({ chainQuantity: BigInt(15), logQuantity: null, purpose: "reconcile" });
    const bucketAt = at(BigInt(109));
    const bucket = { bucketAt, blockNumber: BigInt(109), blockHash: hash, blockTime: bucketAt };
    const before = (await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === token.key)!;
    expect(before.segments).toEqual([{ fromBlock: BigInt(10), toBlock: null, method: "archive-read" }]);
    expect(before.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(109), status: "unavailable", reason: "pending-read" });
    head = BigInt(120);
    const available = quantity;
    quantity = (block, key) => block === BigInt(120) && key === token.key ? null : available(block, key);
    await run();
    expect((await store.listCheckpoints(row.id)).find((point) => point.asset.key === token.key && point.blockNumber === BigInt(110))
      ?.logQuantity).toBeNull();
    const unavailable = (await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === token.key)!;
    expect(unavailable.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(109), status: "unavailable", reason: "pending-read" });
    quantity = available;
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile")
      .map((point) => [point.blockNumber, point.chainQuantity, point.logQuantity])).toEqual([
        [BigInt(110), BigInt(15), BigInt(15)], [BigInt(120), BigInt(15), BigInt(15)],
      ]);
    const resumedAt = at(BigInt(115));
    const after = (await ingest().readQuantities(address, { buckets: [{ bucketAt: resumedAt, blockNumber: BigInt(115),
      blockHash: hash, blockTime: resumedAt }], heldAssets: [], maxArchiveReads: 0 })).find((entry) => entry.asset.key === token.key)!;
    expect(after.segments).toEqual([
      { fromBlock: BigInt(10), toBlock: BigInt(110), method: "archive-read" },
      { fromBlock: BigInt(110), toBlock: null, method: "transfer-log" },
    ]);
    expect(after.buckets[0]?.quantity).toEqual({ blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(15) });
  });

  test("a reconcile prepared before concurrent replay recomputes under the address lock", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(110 + 30 * 86_400 / 2);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const delayed = new Proxy(store, { get(target, property, receiver) {
      if (property === "putReconcileCheckpoints") return async (input: Parameters<typeof store.putReconcileCheckpoints>[0]) => {
        reached();
        await gate;
        return target.putReconcileCheckpoints(input);
      };
      return Reflect.get(target, property, receiver);
    } });
    const slow = createHistoryIngest({ store: delayed, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(0) })
      .run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 });
    await entered;
    const before = await store.sumChanges({ addressId: row.id, fromBlockExclusive: BigInt(10), boundaries: [head] });
    expect(before.find((entry) => entry.asset.key === token.key)?.sums).toEqual([BigInt(12)]);
    expect(await store.appendReplayChanges({ addressId: row.id, changes: [makeChange(108, 4)], invalidateAboveBlock: BigInt(100) })).toBe(1);
    release();
    expect((await slow).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === token.key && point.purpose === "reconcile")
      .map((point) => [point.blockNumber, point.chainQuantity, point.logQuantity])).toEqual([
        [BigInt(110), BigInt(15), BigInt(19)], [head, BigInt(15), BigInt(19)],
      ]);
    const bucketAt = at(BigInt(109));
    const read = await ingest().readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(109), blockHash: hash, blockTime: bucketAt }],
      heldAssets: [], maxArchiveReads: 0 });
    expect(read.find((entry) => entry.asset.key === token.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(109), status: "unavailable", reason: "pending-read" });
  });

  test("replays an already committed forward range to import a late-indexed transfer", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(120);
    await run();
    changes.push(makeChange(119, 4));
    head = BigInt(130);
    queries = [];
    const replay = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(5) });
    expect((await replay.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 })).status).toBe("ready");
    expect(queries).toEqual([{ from: BigInt(115), to: BigInt(120) }, { from: BigInt(9), to: BigInt(15) },
      { from: BigInt(120), to: BigInt(130) }]);
    expect((await sql.query<{ block_number: string }>("SELECT block_number FROM balance_changes WHERE address_id=$1 AND block_number=119", [row.id])).rows
      .map((entry) => BigInt(entry.block_number))).toEqual([BigInt(119)]);
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(130));
  });

  test("replays the newest committed backfill boundary before resuming backfill", async () => {
    const chunk = BigInt(31 * 43_200);
    head = BigInt(10) + chunk + BigInt(20);
    changes = [];
    const row = (await ingest().enroll(address))!;
    let nowMs = time.getTime();
    const original = source;
    source = { async listChanges(input) {
      const result = await original.listChanges(input);
      nowMs += 2_000;
      return result;
    } };
    await createHistoryIngest({ store, source, chain, now: () => new Date(nowMs), lagBlocks: BigInt(0), replayBlocks: BigInt(0) })
      .run(address, { heldAssets: [token], deadline: time.getTime() + 3_000 });
    const cursor = head - chunk;
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(cursor);
    changes.push(makeChange(Number(cursor + BigInt(2)), 4));
    source = original;
    queries = [];
    const replay = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(5) });
    expect((await replay.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 })).status).toBe("ready");
    expect(queries).toEqual([{ from: head - BigInt(5), to: head }, { from: cursor - BigInt(1), to: cursor + BigInt(5) },
      { from: BigInt(10), to: cursor }]);
    expect((await sql.query<{ block_number: string }>("SELECT block_number FROM balance_changes WHERE address_id=$1", [row.id])).rows
      .map((entry) => BigInt(entry.block_number))).toEqual([cursor + BigInt(2)]);
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(10));
  });

  test("replays from the first valid block when the window starts at genesis", async () => {
    const row = (await store.enroll({ chainId: 8453, address, windowStartBlock: BigInt(0),
      windowStartAt: windowAt, enrolledBlock: BigInt(110) }))!;
    await run();
    queries = [];
    const replay = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(5) });
    expect((await replay.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 })).status).toBe("ready");
    expect(queries).toEqual([{ from: BigInt(105), to: BigInt(110) }, { from: BigInt(0), to: BigInt(5) }]);
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(0));
    expect(await count("balance_changes", row.id)).toBe(2);
  });

  test("zero replay blocks skip both replay queries", async () => {
    await ingest().enroll(address);
    await run();
    head = BigInt(120);
    queries = [];
    expect((await run()).queries).toBe(1);
    expect(queries).toEqual([{ from: BigInt(110), to: BigInt(120) }]);
    queries = [];
    expect((await run()).queries).toBe(0);
    expect(queries).toEqual([]);
  });

  test("a replay source failure leaves both cursors unchanged", async () => {
    const row = (await ingest().enroll(address))!;
    await store.commitBackfillChunk({ addressId: row.id, expectedBackfillBlock: BigInt(110),
      nextBackfillBlock: BigInt(100), changes: [] });
    head = BigInt(120);
    const original = source;
    source = { async listChanges(input) {
      if (input.fromBlockExclusive === BigInt(99)) throw new Error("source unavailable");
      return original.listChanges(input);
    } };
    const replay = createHistoryIngest({ store, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(5) });
    expect(await replay.run(address, { heldAssets: [token], deadline: time.getTime() + 100_000 })).toMatchObject(
      { status: "building", queries: 1 });
    expect((await store.getAddress(8453, address))?.backfillBlock).toBe(BigInt(100));
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
  });

  test("forward stops at each finalized head even if dirty and a later head advances", async () => {
    await ingest().enroll(address);
    await run();
    await store.markDirty(8453, [address], time);
    expect((await run()).queries).toBe(0);
    head = BigInt(120);
    changes.push(makeChange(115, 4));
    expect((await run()).queries).toBe(1);
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(120));
  });

  test("log-derived buckets past the forward cursor wait for ingestion while archive reads remain available", async () => {
    await sql.query("UPDATE history_assets SET kind='erc20' WHERE chain_id=8453 AND asset_key=$1", [unknown.key]);
    await ingest().enroll(address);
    expect((await run([unknown])).status).toBe("ready");
    changes.push(makeChange(115, 4));
    head = BigInt(120);
    const bucketAt = at(BigInt(115));
    const bucket = { bucketAt, blockNumber: BigInt(115), blockHash: hash, blockTime: bucketAt };
    const before = await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 1 });
    expect(before.find((entry) => entry.asset.key === token.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(115), status: "unavailable", reason: "pending-read" });
    expect(before.find((entry) => entry.asset.key === nativeHistoryAsset().key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(115), status: "unavailable", reason: "pending-read" });
    expect(before.find((entry) => entry.asset.key === unknown.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(0) });
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(110));
    expect((await run()).status).toBe("ready");
    const after = await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 });
    expect(after.find((entry) => entry.asset.key === token.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(19) });
    expect((await store.getAddress(8453, address))?.forwardBlock).toBe(BigInt(120));
  });

  test("a held asset with no stored change or checkpoint is pending, not dropped", async () => {
    await ingest().enroll(address);
    expect((await run([token])).status).toBe("ready");
    const bucketAt = at(BigInt(105));
    const bucket = { bucketAt, blockNumber: BigInt(105), blockHash: hash, blockTime: bucketAt };
    const pending = await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [token, unknown], maxArchiveReads: 1 });
    expect(pending.find((entry) => entry.asset.key === unknown.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(105), status: "unavailable", reason: "pending-read" });
    expect((await run([token, unknown])).status).toBe("ready");
    const anchored = await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [token, unknown], maxArchiveReads: 1 });
    expect(anchored.find((entry) => entry.asset.key === unknown.key)?.buckets[0]?.quantity)
      .toEqual({ blockNumber: BigInt(105), status: "ready", baseUnits: BigInt(0) });
  });


  test("a held asset never erases verified metadata from an anchored asset", async () => {
    const verified = contractHistoryAsset("0x00000000000000000000000000000000000000cc", { decimals: 6, cashCurrency: "EUR" });
    const key = verified.key;
    await ingest().enroll(address);
    await store.putAssets(8453, [verified]);
    const stored = await sql.query<{ decimals: number; cash_currency: string; kind: string }>("SELECT kind, decimals, cash_currency FROM history_assets WHERE asset_key=$1", [key]);
    expect(stored.rows[0]).toEqual({ kind: "erc20", decimals: 6, cash_currency: "EUR" });
    await run([{ ...verified, decimals: undefined, cashCurrency: null }]);
    const kept = await sql.query<{ decimals: number; cash_currency: string; kind: string }>("SELECT kind, decimals, cash_currency FROM history_assets WHERE asset_key=$1", [key]);
    expect(kept.rows[0]).toEqual({ kind: "erc20", decimals: 6, cash_currency: "EUR" });
    const bucketAt = at(BigInt(108));
    const read = await ingest().readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(108), blockHash: hash, blockTime: bucketAt }],
      heldAssets: [{ ...verified, decimals: undefined, cashCurrency: null }], maxArchiveReads: 0 });
    expect(read.find((entry) => entry.asset.key === key)?.asset)
      .toMatchObject({ kind: "erc20", decimals: 6, cashCurrency: "EUR" });
  });

  test("an ingest write refreshes a stale stored kind from configuration", async () => {
    const vault = portfolioVaults[0]!;
    const key = erc20AssetKey(vault.address);
    const stale: HistoryAsset = { key, kind: "erc20", contractAddress: vault.address.toLowerCase() as HexAddress, marketId: null };
    const storedKind = async () => (await sql.query<{ kind: string }>("SELECT kind FROM history_assets WHERE asset_key=$1", [key])).rows[0]?.kind;
    await ingest().enroll(address);
    const row = (await store.getAddress(8453, address))!;
    await sql.query("UPDATE history_assets SET kind='erc20' WHERE chain_id=8453 AND asset_key=$1", [key]);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(111),
      changes: [makeChange(111, 5, stale)], ingestedAt: time, clearDirtyObservedBefore: null });
    expect(await storedKind()).toBe("erc20");
    expect((await run([])).status).toBe("ready");
    expect(await storedKind()).toBe("vault-share");
  });

  test("a stored erc20 row for a configured vault reads back as a vault share", async () => {
    const vault = portfolioVaults[0]!;
    const key = erc20AssetKey(vault.address);
    const stale: HistoryAsset = { key, kind: "erc20", contractAddress: vault.address.toLowerCase() as HexAddress, marketId: null };
    await ingest().enroll(address);
    expect((await run([])).status).toBe("ready");
    const row = (await store.getAddress(8453, address))!;
    await sql.query("UPDATE history_assets SET kind='erc20' WHERE chain_id=8453 AND asset_key=$1", [key]);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(115),
      changes: [makeChange(112, 5, stale)], ingestedAt: time, clearDirtyObservedBefore: null });
    const bucketAt = at(BigInt(112));
    const result = await ingest().readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(112), blockHash: hash, blockTime: bucketAt }],
      heldAssets: [], maxArchiveReads: 0 });
    expect(result.find((entry) => entry.asset.key === key)?.asset.kind).toBe("vault-share");
  });
  test("a removed vault keeps its stored provenance through transfer upserts, ingest, and bucket reads", async () => {
    const contract = "0x0000000000000000000000000000000000000044";
    const removed = contractHistoryAsset(contract, { kind: "vault-share" });
    const held = contractHistoryAsset(contract, { kind: "erc20", decimals: 18 });
    const row = (await ingest().enroll(address))!;
    await store.putCheckpoints(row.id, [{ asset: removed, blockNumber: BigInt(10), purpose: "window-start",
      chainQuantity: BigInt(1), logQuantity: null, observedAt: time }]);
    await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: BigInt(110), nextForwardBlock: BigInt(111),
      changes: [makeChange(111, 5, contractHistoryAsset(contract))], ingestedAt: time, clearDirtyObservedBefore: null });
    const storedKind = async () => (await store.listTrackedAssets(row.id)).find((asset) => asset.key === removed.key)?.kind;
    expect(await storedKind()).toBe("vault-share");
    head = BigInt(120);
    const seen: HistoryAsset[] = [];
    const original = chain.readQuantities;
    chain = { ...chain, async readQuantities(input) { seen.push(...input.assets); return original(input); } };
    expect((await run([held])).status).toBe("ready");
    expect(seen.find((asset) => asset.key === removed.key)).toEqual({
      key: "eip155:8453/erc20:0x0000000000000000000000000000000000000044", kind: "vault-share",
      contractAddress: "0x0000000000000000000000000000000000000044", marketId: null, decimals: 18,
    });
    expect(await storedKind()).toBe("vault-share");
    const bucketAt = at(BigInt(115));
    const result = await ingest().readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(115), blockHash: hash, blockTime: bucketAt }],
      heldAssets: [held], maxArchiveReads: 0 });
    expect(result.find((entry) => entry.asset.key === removed.key)?.asset).toEqual({
      key: "eip155:8453/erc20:0x0000000000000000000000000000000000000044", kind: "vault-share",
      contractAddress: "0x0000000000000000000000000000000000000044", marketId: null, decimals: 18,
    });
    expect(await storedKind()).toBe("vault-share");
  });

  test("positive stored native snapshot requires archive reads despite a zero forward checkpoint", async () => {
    const native = nativeHistoryAsset();
    const original = quantity;
    quantity = (block, key) => key === native.key
      ? block === BigInt(100) ? BigInt(9) : block === BigInt(115) ? BigInt(7) : BigInt(0)
      : original(block, key);
    const row = (await ingest().enroll(address))!;
    expect((await run()).status).toBe("ready");
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === native.key)
      .map((point) => [point.blockNumber, point.chainQuantity])).toEqual([
        [BigInt(10), BigInt(0)], [BigInt(110), BigInt(0)],
      ]);
    head = BigInt(120);
    await sql.query(`INSERT INTO balance_snapshots
      (chain_id, address, block_number, block_hash, block_timestamp, observed_at, holdings, coverage)
      VALUES (8453,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [address, "115", hash, String(at(BigInt(115)).getTime() / 1_000), time,
      JSON.stringify([{ key: native.key, id: native.key, kind: "native", source: "catalog", name: "Ethereum",
        symbol: "ETH", decimals: 18, contractAddress: null, cashCurrency: null, balance: { status: "ready", baseUnits: "7" } }]),
      JSON.stringify({ registry: "complete", catalog: "complete" })]);
    const { heldAssets } = historyInventoryFromSnapshot(await new PostgresBalanceSnapshotStore(sql).get(8453, address));
    expect(heldAssets).toEqual([native]);
    expect(await run(heldAssets)).toMatchObject({ status: "ready", reads: 0 });
    expect((await store.listCheckpoints(row.id)).filter((point) => point.asset.key === native.key)
      .map((point) => [point.blockNumber, point.chainQuantity])).toEqual([
        [BigInt(10), BigInt(0)], [BigInt(110), BigInt(0)],
      ]);
    head = BigInt(110 + 30 * 86_400 / 2);
    expect(await run(heldAssets)).toMatchObject({ status: "ready", reads: 1 });
    expect((await store.listCheckpoints(row.id)).find((point) => point.asset.key === native.key && point.blockNumber === head))
      .toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(0), logQuantity: BigInt(0) });
    const bucket = (block: number) => ({ bucketAt: at(BigInt(block)), blockNumber: BigInt(block), blockHash: hash, blockTime: at(BigInt(block)) });
    const buckets = [bucket(100), bucket(115), bucket(120)];
    const pending = (await ingest().readQuantities(address, { buckets, heldAssets, maxArchiveReads: 0 }))
      .find((entry) => entry.asset.key === native.key)!;
    expect(pending.segments).toEqual([{ fromBlock: BigInt(10), toBlock: null, method: "archive-read" }]);
    expect(pending.buckets.map(({ quantity: value }) => value)).toEqual([
      { blockNumber: BigInt(100), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(115), status: "unavailable", reason: "pending-read" },
      { blockNumber: BigInt(120), status: "unavailable", reason: "pending-read" },
    ]);
    const resolved = (await ingest().readQuantities(address, { buckets, heldAssets, maxArchiveReads: 3 }))
      .find((entry) => entry.asset.key === native.key)!;
    expect(resolved.buckets.map(({ quantity: value }) => value)).toEqual([
      { blockNumber: BigInt(100), status: "ready", baseUnits: BigInt(9) },
      { blockNumber: BigInt(115), status: "ready", baseUnits: BigInt(7) },
      { blockNumber: BigInt(120), status: "ready", baseUnits: BigInt(0) },
    ]);
  });

  test("an asset alone in its window is reconciled even when another asset was verified recently", async () => {
    const row = (await ingest().enroll(address))!;
    const morpho = morphoHistoryAssets(BORROW_MARKETS[0]!.marketId);
    const aged = BigInt(1_000_000);
    const recent = BigInt(2_900_000);
    await store.putCheckpoints(row.id, [
      { asset: token, blockNumber: BigInt(10), purpose: "window-start", chainQuantity: BigInt(3), logQuantity: null, observedAt: time },
      { asset: token, blockNumber: aged, purpose: "reconcile", chainQuantity: BigInt(3), logQuantity: BigInt(3), observedAt: time },
      { asset: morpho[0], blockNumber: recent, purpose: "bucket", chainQuantity: BigInt(1), logQuantity: null, observedAt: time },
    ]);
    head = BigInt(3_000_000);
    quantity = () => BigInt(15);
    requested = [];
    await run([morpho[0]]);
    const reconcileIndex = reads.findIndex((block) => block === BigInt(3_000_000));
    expect(reconcileIndex).toBeGreaterThanOrEqual(0);
    expect(requested[reconcileIndex]).toContain(token.key);
    expect(requested[reconcileIndex]).not.toContain(morpho[0].key);
    expect(reads.filter((block) => block === BigInt(3_000_000))).toHaveLength(1);
    const checkpoints = await store.listCheckpoints(row.id);
    expect(checkpoints.some((point) => point.asset.key === token.key && point.blockNumber === BigInt(3_000_000) && point.purpose === "reconcile"))
      .toBe(true);
    expect(checkpoints.filter((point) => point.asset.key === morpho[0].key && point.blockNumber > row.windowStartBlock)
      .map((point) => point.blockNumber)).toEqual([recent]);
  });

  test("reconciliation promotes a same-block bucket quantity without rereading that asset", async () => {
    const row = (await ingest().enroll(address))!;
    await store.putCheckpoints(row.id, [{ asset: token, blockNumber: BigInt(110), purpose: "bucket",
      chainQuantity: BigInt(15), logQuantity: null, observedAt: time }]);
    expect((await run()).status).toBe("ready");
    const readAtCursor = reads.findIndex((block) => block === BigInt(110));
    expect(readAtCursor).toBeGreaterThanOrEqual(0);
    expect(requested[readAtCursor]).not.toContain(token.key);
    expect((await store.listCheckpoints(row.id)).find((point) => point.asset.key === token.key && point.blockNumber === BigInt(110)))
      .toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(15), logQuantity: BigInt(15) });
  });

  test("reconciliation waits for the interval and then checkpoints the new finalized head", async () => {
    const row = (await ingest().enroll(address))!;
    await run();
    head = BigInt(120);
    expect((await run()).reads).toBe(0);
    head = BigInt(110 + 30 * 86_400 / 2);
    expect((await run()).reads).toBe(1);
    const point = (await store.listCheckpoints(row.id)).find((entry) => entry.asset.key === token.key && entry.blockNumber === head);
    expect(point).toMatchObject({ purpose: "reconcile", chainQuantity: BigInt(15), logQuantity: BigInt(15) });
  });

  test("bucket reads load one snapshot across assets", async () => {
    changes.push(makeChange(105, 5, unknown));
    quantity = (block, key) => key === unknown.key ? block === BigInt(10) ? BigInt(0) : BigInt(5) :
      key === token.key ? block === BigInt(10) ? BigInt(3) : BigInt(15) : BigInt(0);
    await ingest().enroll(address);
    await run([unknown]);
    head = BigInt(120);
    await run([unknown]);
    const seen: bigint[][] = [];
    const counted = new Proxy(store, { get(target, property, receiver) {
      if (property === "readIngestSnapshot") return async (input: Parameters<typeof store.readIngestSnapshot>[0]) => {
        seen.push([...input.changeBoundaries]);
        return target.readIngestSnapshot(input);
      };
      return Reflect.get(target, property, receiver);
    } });
    const service = createHistoryIngest({ store: counted, source, chain, now: () => time, lagBlocks: BigInt(0), replayBlocks: BigInt(0) });
    const bucketAt = new Date(windowAt.getTime() + 115 * 3_600_000);
    const result = await service.readQuantities(address, { buckets: [{ bucketAt, blockNumber: BigInt(115),
      blockHash: hash, blockTime: bucketAt }], heldAssets: [], maxArchiveReads: 0 });
    expect(seen).toEqual([[BigInt(115)]]);
    expect(result.find((row) => row.asset.key === unknown.key)?.buckets[0]?.quantity)
      .toMatchObject({ status: "ready", baseUnits: BigInt(5) });
  });

  test("unknown ERC-20 promotes after matching reconcile and a mismatch needs bounded archive reads", async () => {
    changes.push(makeChange(105, 5, unknown));
    await sql.query("UPDATE history_assets SET kind='erc20' WHERE chain_id=8453 AND asset_key=$1", [unknown.key]);
    quantity = (block, key) => key === unknown.key ? block === BigInt(10) ? BigInt(0) : BigInt(5) :
      key === token.key ? block === BigInt(10) ? BigInt(3) : BigInt(15) : BigInt(0);
    await ingest().enroll(address);
    await run([unknown]);
    const bucket = (block: number) => ({ bucketAt: new Date(windowAt.getTime() + block * 3_600_000),
      blockNumber: BigInt(block), blockHash: hash, blockTime: windowAt });
    const before = await ingest().readQuantities(address, { buckets: [bucket(104), bucket(110)], heldAssets: [], maxArchiveReads: 0 });
    const first = before.find((entry) => entry.asset.key === unknown.key)!;
    expect(first.segments.at(-1)?.method).toBe("transfer-log");
    expect(first.buckets[0].quantity).toMatchObject({ status: "unavailable", reason: "pending-read" });
    await sql.query("DELETE FROM balance_checkpoints WHERE purpose='reconcile' AND asset_id=(SELECT id FROM history_assets WHERE asset_key=$1)", [unknown.key]);
    head = BigInt(130);
    quantity = (block, key) => key === unknown.key ? block === BigInt(130) ? BigInt(99) : BigInt(5) :
      key === token.key ? block === BigInt(10) ? BigInt(3) : BigInt(15) : BigInt(0);
    await run([unknown, contractHistoryAsset("0x0000000000000000000000000000000000000077")]);
    const result = await ingest().readQuantities(address, { buckets: [bucket(120), bucket(125), bucket(130)], heldAssets: [], maxArchiveReads: 1 });
    const mismatched = result.find((entry) => entry.asset.key === unknown.key)!;
    expect(mismatched.segments.at(-1)?.method).toBe("archive-read");
    expect(mismatched.buckets.map(({ quantity: value }) => value.status)).toEqual(["unavailable", "unavailable", "ready"]);
    expect(reads.at(-1)).toBe(BigInt(130));
    const second = await ingest().readQuantities(address, { buckets: [bucket(120), bucket(125), bucket(130)], heldAssets: [], maxArchiveReads: 1 });
    expect(second.find((entry) => entry.asset.key === unknown.key)?.buckets.map(({ quantity: value }) => value.status))
      .toEqual(["unavailable", "ready", "ready"]);
    expect(reads.at(-1)).toBe(BigInt(125));
    const resumed = await ingest().readQuantities(address, { buckets: [bucket(120), bucket(125), bucket(130)], heldAssets: [], maxArchiveReads: 1 });
    expect(resumed.find((entry) => entry.asset.key === unknown.key)?.buckets.every(({ quantity: value }) => value.status === "ready")).toBe(true);
  });

  test("a zero-delta self-transfer alone does not promote an unknown ERC-20", async () => {
    changes.push(makeChange(105, 0, unknown));
    await ingest().enroll(address);
    expect((await run([unknown])).status).toBe("ready");
    const bucketAt = at(BigInt(105));
    const bucket = { bucketAt, blockNumber: BigInt(105), blockHash: hash, blockTime: bucketAt };
    const read = await ingest().readQuantities(address, { buckets: [bucket], heldAssets: [], maxArchiveReads: 0 });
    expect(read.find((entry) => entry.asset.key === unknown.key)?.segments).toEqual([
      { fromBlock: BigInt(10), toBlock: null, method: "archive-read" },
    ]);
  });
});
