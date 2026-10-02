import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { FiatCurrencyCode } from "@/config/regions";
import type {
  BalanceChange, BalanceCheckpoint, ChainBucket, ChangeSums, ChunkCommit, Granularity,
  HexAddress, HexHash, HistoryAddress, HistoryAsset, HistoryStore, HistoryWriteOptions, TransferLoggedAsset, ValuationPoint,
} from "./types";

type Row = Record<string, unknown>;

function addressRow(row: Row): HistoryAddress {
  return {
    id: Number(row.id), chainId: Number(row.chain_id), address: String(row.address) as HexAddress,
    windowStartBlock: BigInt(String(row.window_start_block)), windowStartAt: new Date(String(row.window_start_at)),
    enrolledBlock: BigInt(String(row.enrolled_block)), backfillBlock: BigInt(String(row.backfill_block)),
    forwardBlock: BigInt(String(row.forward_block)), dirtyAt: row.dirty_at == null ? null : new Date(String(row.dirty_at)),
    ingestedAt: row.ingested_at == null ? null : new Date(String(row.ingested_at)),
  };
}

function assetRow(row: Row): HistoryAsset {
  return {
    key: String(row.asset_key), kind: String(row.kind),
    contractAddress: row.contract_address == null ? null : String(row.contract_address),
    marketId: row.market_id == null ? null : String(row.market_id),
    ...(row.decimals == null ? {} : { decimals: Number(row.decimals) }),
    ...(row.cash_currency == null ? {} : { cashCurrency: String(row.cash_currency) as FiatCurrencyCode }),
  } as HistoryAsset;
}

function textArray(values: readonly (string | null)[]): string {
  return `{${values.map((value) => value === null ? "NULL" : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

async function ensureAssets(sql: SqlExecutor, chainId: number, assets: readonly HistoryAsset[]): Promise<Map<string, number>> {
  const unique = [...new Map(assets.map((asset) => [asset.key, asset])).values()];
  if (unique.length === 0) return new Map();
  await sql.query(
    `INSERT INTO history_assets (chain_id, asset_key, kind, contract_address, market_id, decimals, cash_currency)
     SELECT $1, a.key, a.kind, a.contract, a.market, a.decimals, a.cash
     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[]) AS a(key, kind, contract, market, decimals, cash)
     ON CONFLICT (chain_id, asset_key) DO UPDATE
       SET kind = CASE WHEN history_assets.kind = 'vault-share' AND EXCLUDED.kind = 'erc20'
         THEN history_assets.kind ELSE EXCLUDED.kind END,
           contract_address = EXCLUDED.contract_address, market_id = EXCLUDED.market_id,
           decimals = COALESCE(history_assets.decimals, EXCLUDED.decimals),
           cash_currency = COALESCE(history_assets.cash_currency, EXCLUDED.cash_currency)
       WHERE history_assets.kind IS DISTINCT FROM EXCLUDED.kind
          OR history_assets.contract_address IS DISTINCT FROM EXCLUDED.contract_address
          OR history_assets.market_id IS DISTINCT FROM EXCLUDED.market_id
          OR (history_assets.decimals IS NULL AND EXCLUDED.decimals IS NOT NULL)
          OR (history_assets.cash_currency IS NULL AND EXCLUDED.cash_currency IS NOT NULL)`,
    [chainId, textArray(unique.map((asset) => asset.key)), textArray(unique.map((asset) => asset.kind)),
      textArray(unique.map((asset) => asset.contractAddress)),
      textArray(unique.map((asset) => asset.marketId)),
      textArray(unique.map((asset) => asset.decimals === undefined ? null : String(asset.decimals))),
      textArray(unique.map((asset) => asset.cashCurrency ?? null))],
  );
  const result = await sql.query<{ id: number; asset_key: string }>(
    "SELECT id, asset_key FROM history_assets WHERE chain_id=$1 AND asset_key=ANY($2::text[])",
    [chainId, textArray(unique.map((asset) => asset.key))],
  );
  return new Map(result.rows.map((row) => [row.asset_key, row.id]));
}

async function insertChanges(sql: SqlExecutor, chainId: number, addressId: number, changes: readonly BalanceChange[]): Promise<{ rowCount: number; assetIds: number[] }> {
  if (changes.length === 0) return { rowCount: 0, assetIds: [] };
  const ids = await ensureAssets(sql, chainId, changes.map((change) => change.asset));
  const result = await sql.query<{ asset_id: number }>(
    `INSERT INTO balance_changes (address_id, asset_id, block_number, log_index, block_time, tx_hash, delta, source)
     SELECT $1, c.asset_id, c.block_number, c.log_index, c.block_time, decode(c.tx_hash, 'hex'), c.delta, 'cdp-sql-transfer'
     FROM unnest($2::int[], $3::bigint[], $4::int[], $5::timestamptz[], $6::text[], $7::numeric[])
       AS c(asset_id, block_number, log_index, block_time, tx_hash, delta)
     ON CONFLICT DO NOTHING RETURNING asset_id`,
    [addressId, textArray(changes.map((c) => String(ids.get(c.asset.key)))),
      textArray(changes.map((c) => c.blockNumber.toString())),
      textArray(changes.map((c) => String(c.logIndex))), textArray(changes.map((c) => c.blockTime.toISOString())),
      textArray(changes.map((c) => c.txHash?.slice(2) ?? null)), textArray(changes.map((c) => c.delta.toString()))],
  );
  return { rowCount: result.rowCount, assetIds: [...new Set(result.rows.map((row) => Number(row.asset_id)))] };
}

async function upsertCheckpoint(sql: SqlExecutor, addressId: number, assetId: number, checkpoint: BalanceCheckpoint): Promise<void> {
  await sql.query(
    `INSERT INTO balance_checkpoints (address_id, asset_id, block_number, purpose, chain_quantity, log_quantity, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (address_id, asset_id, block_number) DO UPDATE SET
     log_quantity=COALESCE(balance_checkpoints.log_quantity, EXCLUDED.log_quantity),
     purpose=CASE WHEN balance_checkpoints.purpose='reconcile' OR EXCLUDED.purpose='reconcile' THEN 'reconcile'
                  WHEN balance_checkpoints.purpose='window-start' OR EXCLUDED.purpose='window-start' THEN 'window-start'
                  ELSE 'bucket' END`,
    [addressId, assetId, checkpoint.blockNumber.toString(), checkpoint.purpose,
      checkpoint.chainQuantity.toString(), checkpoint.logQuantity?.toString() ?? null, checkpoint.observedAt],
  );
}

export class PostgresHistoryStore implements HistoryStore {
  constructor(private readonly sql: SqlExecutor) {}

  async enroll(input: { chainId: number; address: HexAddress; windowStartBlock: bigint; windowStartAt: Date; enrolledBlock: bigint }): Promise<HistoryAddress | null> {
    const address = input.address.toLowerCase();
    await this.sql.query(
      `INSERT INTO history_addresses (chain_id, address, window_start_block, window_start_at, enrolled_block, backfill_block, forward_block)
       SELECT chain_id, address, $3, $4, $5, $5, $5 FROM customer_wallets
       WHERE chain_id=$1 AND address=$2 ON CONFLICT (chain_id, address) DO NOTHING`,
      [input.chainId, address, input.windowStartBlock.toString(), input.windowStartAt, input.enrolledBlock.toString()],
    );
    return this.getAddress(input.chainId, address as HexAddress);
  }

  async getAddress(chainId: number, address: HexAddress): Promise<HistoryAddress | null> {
    const result = await this.sql.query("SELECT * FROM history_addresses WHERE chain_id=$1 AND address=$2", [chainId, address.toLowerCase()]);
    return result.rows[0] ? addressRow(result.rows[0]) : null;
  }

  async markDirty(chainId: number, addresses: readonly HexAddress[], at: Date, options?: HistoryWriteOptions): Promise<number> {
    if (addresses.length === 0) return 0;
    const result = await this.sql.query(
      "UPDATE history_addresses SET dirty_at=GREATEST(dirty_at,$3::timestamptz) WHERE chain_id=$1 AND address=ANY($2::text[])",
      [chainId, textArray(addresses.map((address) => address.toLowerCase())), at],
      options,
    );
    return result.rowCount;
  }

  async appendReplayChanges(input: { addressId: number; changes: readonly BalanceChange[]; invalidateAboveBlock: bigint }): Promise<number> {
    if (input.changes.length === 0) return 0;
    return this.sql.transaction(async (tx) => {
      const address = await tx.query("SELECT chain_id FROM history_addresses WHERE id=$1 FOR UPDATE", [input.addressId]);
      if (!address.rows[0]) throw new Error("History address not found");
      const inserted = await insertChanges(tx, Number(address.rows[0].chain_id), input.addressId, input.changes);
      if (inserted.assetIds.length) {
        await tx.query(
          `UPDATE balance_checkpoints SET log_quantity=NULL
           WHERE address_id=$1 AND purpose='reconcile' AND block_number > $2
             AND asset_id=ANY($3::int[]) AND log_quantity IS NOT NULL`,
          [input.addressId, input.invalidateAboveBlock.toString(), textArray(inserted.assetIds.map(String))],
        );
      }
      return inserted.rowCount;
    });
  }

  async commitBackfillChunk(input: { addressId: number; expectedBackfillBlock: bigint; nextBackfillBlock: bigint; changes: readonly BalanceChange[] }): Promise<ChunkCommit> {
    return this.sql.transaction(async (tx) => {
      const result = await tx.query("SELECT chain_id, window_start_block, backfill_block FROM history_addresses WHERE id=$1 FOR UPDATE", [input.addressId]);
      const row = result.rows[0];
      if (!row || BigInt(String(row.backfill_block)) !== input.expectedBackfillBlock) return "conflict";
      if (input.nextBackfillBlock < BigInt(String(row.window_start_block)) || input.nextBackfillBlock >= input.expectedBackfillBlock ||
        input.changes.some((change) => change.blockNumber <= input.nextBackfillBlock || change.blockNumber > input.expectedBackfillBlock)) {
        throw new Error("Invalid backfill chunk range");
      }
      await insertChanges(tx, Number(row.chain_id), input.addressId, input.changes);
      await tx.query("UPDATE history_addresses SET backfill_block=$2 WHERE id=$1", [input.addressId, input.nextBackfillBlock.toString()]);
      return "committed";
    });
  }

  async commitForwardChunk(input: { addressId: number; expectedForwardBlock: bigint; nextForwardBlock: bigint; changes: readonly BalanceChange[]; ingestedAt: Date; clearDirtyObservedBefore: Date | null }): Promise<ChunkCommit> {
    return this.sql.transaction(async (tx) => {
      const result = await tx.query("SELECT chain_id, forward_block FROM history_addresses WHERE id=$1 FOR UPDATE", [input.addressId]);
      const row = result.rows[0];
      if (!row || BigInt(String(row.forward_block)) !== input.expectedForwardBlock) return "conflict";
      if (input.nextForwardBlock <= input.expectedForwardBlock ||
        input.changes.some((change) => change.blockNumber <= input.expectedForwardBlock || change.blockNumber > input.nextForwardBlock)) {
        throw new Error("Invalid forward chunk range");
      }
      await insertChanges(tx, Number(row.chain_id), input.addressId, input.changes);
      await tx.query(
        `UPDATE history_addresses SET forward_block=$2, ingested_at=$3,
         dirty_at=CASE WHEN dirty_at <= $4::timestamptz THEN NULL ELSE dirty_at END WHERE id=$1`,
        [input.addressId, input.nextForwardBlock.toString(), input.ingestedAt, input.clearDirtyObservedBefore],
      );
      return "committed";
    });
  }

  async putCheckpoints(addressId: number, checkpoints: readonly BalanceCheckpoint[]): Promise<void> {
    if (checkpoints.length === 0) return;
    await this.sql.transaction(async (tx) => {
      const address = await tx.query("SELECT chain_id FROM history_addresses WHERE id=$1", [addressId]);
      if (!address.rows[0]) throw new Error("History address not found");
      const ids = await ensureAssets(tx, Number(address.rows[0].chain_id), checkpoints.map((c) => c.asset));
      for (const checkpoint of checkpoints) {
        await upsertCheckpoint(tx, addressId, ids.get(checkpoint.asset.key)!, checkpoint);
      }
    });
  }

  async putReconcileCheckpoints(input: { addressId: number; windowStartBlock: bigint; checkpoints: readonly {
    asset: TransferLoggedAsset; blockNumber: bigint; chainQuantity: bigint; anchorQuantity: bigint; observedAt: Date;
  }[] }): Promise<void> {
    if (input.checkpoints.length === 0) return;
    await this.sql.transaction(async (tx) => {
      const address = await tx.query("SELECT chain_id FROM history_addresses WHERE id=$1 FOR UPDATE", [input.addressId]);
      if (!address.rows[0]) throw new Error("History address not found");
      const ids = await ensureAssets(tx, Number(address.rows[0].chain_id), input.checkpoints.map((point) => point.asset));
      const pending = await tx.query<{ asset_id: number; block_number: string; chain_quantity: string; observed_at: Date }>(
        `SELECT asset_id, block_number, chain_quantity, observed_at FROM balance_checkpoints
         WHERE address_id=$1 AND asset_id=ANY($2::int[]) AND purpose='reconcile' AND log_quantity IS NULL`,
        [input.addressId, textArray([...ids.values()].map(String))],
      );
      for (const current of input.checkpoints) {
        const assetId = ids.get(current.asset.key)!;
        const checkpoints = pending.rows.filter((point) => Number(point.asset_id) === assetId && BigInt(point.block_number) !== current.blockNumber).map((point) => ({
          asset: current.asset, blockNumber: BigInt(point.block_number), chainQuantity: BigInt(point.chain_quantity),
          observedAt: new Date(point.observed_at),
        }));
        checkpoints.push(current);
        for (const point of checkpoints) {
          const result = await tx.query<{ total: string }>(
            `SELECT COALESCE(sum(delta), 0) AS total FROM balance_changes
             WHERE address_id=$1 AND asset_id=$2 AND block_number > $3 AND block_number <= $4`,
            [input.addressId, assetId, input.windowStartBlock.toString(), point.blockNumber.toString()],
          );
          await upsertCheckpoint(tx, input.addressId, assetId, {
            ...point, purpose: "reconcile", logQuantity: current.anchorQuantity + BigInt(result.rows[0]!.total),
          });
        }
      }
    });
  }

  async readIngestSnapshot(input: { addressId: number; fromBlockExclusive: bigint; changeBoundaries: readonly bigint[] }):
    Promise<{ checkpoints: BalanceCheckpoint[]; sums: ChangeSums[]; checkpointSums: ChangeSums[] }> {
    return this.sql.transaction(async (tx) => {
      const address = await tx.query("SELECT id FROM history_addresses WHERE id=$1 FOR SHARE", [input.addressId]);
      if (!address.rows[0]) throw new Error("History address not found");
      const checkpoints = await this.listCheckpointsWithSql(tx, input.addressId);
      const checkpointBoundaries = [...new Set(checkpoints.filter((point) => point.blockNumber > input.fromBlockExclusive)
        .map((point) => point.blockNumber))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const sums = await this.sumChangesWithSql(tx, { addressId: input.addressId, fromBlockExclusive: input.fromBlockExclusive,
        boundaries: input.changeBoundaries });
      const checkpointSums = await this.sumChangesWithSql(tx, { addressId: input.addressId, fromBlockExclusive: input.fromBlockExclusive,
        boundaries: checkpointBoundaries });
      return { checkpoints, sums, checkpointSums };
    });
  }

  async listCheckpoints(addressId: number): Promise<BalanceCheckpoint[]> {
    return this.listCheckpointsWithSql(this.sql, addressId);
  }

  private async listCheckpointsWithSql(sql: SqlExecutor, addressId: number): Promise<BalanceCheckpoint[]> {
    const result = await sql.query(
      `SELECT a.asset_key, a.kind, a.contract_address, a.market_id, c.* FROM balance_checkpoints c
       JOIN history_assets a ON a.id=c.asset_id WHERE c.address_id=$1 ORDER BY a.asset_key, c.block_number`, [addressId],
    );
    return result.rows.map((row) => ({
      asset: assetRow(row), blockNumber: BigInt(String(row.block_number)), purpose: String(row.purpose) as BalanceCheckpoint["purpose"],
      chainQuantity: BigInt(String(row.chain_quantity)), logQuantity: row.log_quantity == null ? null : BigInt(String(row.log_quantity)),
      observedAt: new Date(String(row.observed_at)),
    }));
  }

  async putAssets(chainId: number, assets: readonly HistoryAsset[]): Promise<void> {
    await ensureAssets(this.sql, chainId, assets);
  }

  async listTrackedAssets(addressId: number): Promise<HistoryAsset[]> {
    const result = await this.sql.query(
      `SELECT asset_key, kind, contract_address, market_id, decimals, cash_currency FROM history_assets WHERE id IN
       (SELECT asset_id FROM balance_changes WHERE address_id=$1 UNION SELECT asset_id FROM balance_checkpoints WHERE address_id=$1)
       ORDER BY asset_key`, [addressId],
    );
    return result.rows.map(assetRow);
  }

  async sumChanges(input: { addressId: number; fromBlockExclusive: bigint; boundaries: readonly bigint[] }): Promise<ChangeSums[]> {
    return this.sumChangesWithSql(this.sql, input);
  }

  private async sumChangesWithSql(sql: SqlExecutor, input: { addressId: number; fromBlockExclusive: bigint; boundaries: readonly bigint[] }): Promise<ChangeSums[]> {
    if (input.boundaries.length === 0) return [];
    if (input.boundaries.some((boundary, index) => boundary <= (index ? input.boundaries[index - 1]! : input.fromBlockExclusive))) {
      throw new Error("Boundaries must be strictly ascending after fromBlockExclusive");
    }
    const result = await sql.query(
      `WITH intervals AS (
         SELECT asset_id, width_bucket(block_number - 1, $3::bigint[]) + 1 AS idx,
                sum(delta) AS amount, count(*) FILTER (WHERE delta <> 0) AS rows_count
         FROM balance_changes WHERE address_id=$1 AND block_number > $2 AND block_number <= $4
         GROUP BY asset_id, idx
       ), totals AS (
         SELECT a.asset_id, bounds.idx,
                sum(coalesce(i.amount, 0)) OVER (PARTITION BY a.asset_id ORDER BY bounds.idx) AS amount,
                sum(coalesce(i.rows_count, 0)) OVER (PARTITION BY a.asset_id ORDER BY bounds.idx) AS rows_count
         FROM (SELECT DISTINCT asset_id FROM intervals) a
         CROSS JOIN generate_subscripts($3::bigint[], 1) AS bounds(idx)
         LEFT JOIN intervals i ON i.asset_id=a.asset_id AND i.idx=bounds.idx
       )
       SELECT h.asset_key, h.kind, h.contract_address, h.market_id, t.idx, t.amount, t.rows_count
       FROM totals t JOIN history_assets h ON h.id=t.asset_id ORDER BY h.asset_key, t.idx`,
      [input.addressId, input.fromBlockExclusive.toString(), textArray(input.boundaries.map(String)), input.boundaries.at(-1)!.toString()],
    );
    const byAsset = new Map<string, ChangeSums>();
    for (const row of result.rows) {
      const key = String(row.asset_key);
      let entry = byAsset.get(key);
      if (!entry) {
        entry = { asset: assetRow(row) as TransferLoggedAsset, sums: [], counts: [] };
        byAsset.set(key, entry);
      }
      entry.sums.push(BigInt(String(row.amount)));
      entry.counts.push(Number(row.rows_count));
    }
    return [...byAsset.values()];
  }

  async getBuckets(chainId: number, bucketTimes: readonly Date[]): Promise<ChainBucket[]> {
    if (bucketTimes.length === 0) return [];
    const result = await this.sql.query(
      `SELECT bucket_at, block_number, encode(block_hash, 'hex') AS block_hash, block_time
       FROM chain_buckets WHERE chain_id=$1 AND bucket_at=ANY($2::timestamptz[]) ORDER BY bucket_at`,
      [chainId, textArray(bucketTimes.map((time) => time.toISOString()))],
    );
    return result.rows.map((row) => ({ bucketAt: new Date(String(row.bucket_at)), blockNumber: BigInt(String(row.block_number)),
      blockHash: `0x${String(row.block_hash)}` as HexHash, blockTime: new Date(String(row.block_time)) }));
  }

  async putBuckets(chainId: number, buckets: readonly ChainBucket[]): Promise<void> {
    for (const bucket of buckets) {
      await this.sql.query(
        `INSERT INTO chain_buckets (chain_id, bucket_at, block_number, block_hash, block_time)
         VALUES ($1,$2,$3,decode($4,'hex'),$5) ON CONFLICT DO NOTHING`,
        [chainId, bucket.bucketAt, bucket.blockNumber.toString(), bucket.blockHash.slice(2), bucket.blockTime],
      );
    }
  }

  async getValuationPoints(input: { seriesKeys: readonly string[]; basisVersion: string; granularity: Granularity; bucketTimes: readonly Date[] }): Promise<ValuationPoint[]> {
    if (input.seriesKeys.length === 0 || input.bucketTimes.length === 0) return [];
    const result = await this.sql.query(
      `SELECT * FROM valuation_points WHERE series_key=ANY($1::text[]) AND basis_version=$2 AND granularity=$3
       AND bucket_at=ANY($4::timestamptz[]) ORDER BY series_key, bucket_at`,
      [textArray(input.seriesKeys), input.basisVersion, input.granularity, textArray(input.bucketTimes.map((t) => t.toISOString()))],
    );
    return result.rows.map((row) => ({
      seriesKey: String(row.series_key), basisVersion: String(row.basis_version), granularity: String(row.granularity) as Granularity,
      bucketAt: new Date(String(row.bucket_at)),
      value: row.value_atoms == null ? null : { atoms: BigInt(String(row.value_atoms)), scale: Number(row.value_scale) },
      blockNumber: row.block_number == null ? null : BigInt(String(row.block_number)),
      source: String(row.source), observedAt: new Date(String(row.observed_at)),
    }));
  }

  async putValuationPoints(points: readonly ValuationPoint[]): Promise<void> {
    for (const point of points) {
      await this.sql.query(
        `INSERT INTO valuation_points (series_key, basis_version, granularity, bucket_at, value_atoms, value_scale, block_number, source, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [point.seriesKey, point.basisVersion, point.granularity, point.bucketAt, point.value?.atoms.toString() ?? null,
          point.value?.scale ?? null, point.blockNumber?.toString() ?? null, point.source, point.observedAt],
      );
    }
  }

  async pruneHourlyValuationPoints(olderThan: Date, batchSize: number): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 0) throw new Error("Invalid batch size");
    if (batchSize === 0) return 0;
    const result = await this.sql.query(
      `DELETE FROM valuation_points WHERE ctid IN
       (SELECT ctid FROM valuation_points WHERE granularity='1h' AND bucket_at < $1 ORDER BY bucket_at LIMIT $2)`,
      [olderThan, batchSize],
    );
    return result.rowCount;
  }
}

let runtimeStore: HistoryStore | null = null;

export function getHistoryStore(): HistoryStore | null {
  if (runtimeStore) return runtimeStore;
  if (!process.env.DATABASE_URL?.trim()) return null;
  runtimeStore = new PostgresHistoryStore(getSqlExecutor());
  return runtimeStore;
}
