import "server-only";

import { getDirectPortfolioAssets, portfolioVaults } from "@/config/portfolio-assets";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { contractHistoryAsset, isStaticArchiveRead, morphoHistoryAssets, nativeHistoryAsset } from "./assets";
import { resolveBucketQuantities } from "./quantities";
import { deriveTracking } from "./tracking";
import {
  HISTORY_CHAIN_ID, HISTORY_INGEST_LAG_BLOCKS, HISTORY_REPLAY_BLOCKS, HISTORY_RECONCILE_INTERVAL_SECONDS, HISTORY_WINDOW_SECONDS,
  type BalanceCheckpoint, type BlockRef, type ChainBucket, type HexAddress, type HistoryAsset, type TransferLoggedAsset,
  type HistoryChainReader, type HistoryStore, type HistoryTransferSource, type HistoryAssetKey, type QuantityRead,
} from "./types";

const registryAssets = getDirectPortfolioAssets().flatMap((asset) => asset.contractAddress
  ? [contractHistoryAsset(asset.contractAddress, { decimals: asset.decimals, cashCurrency: asset.cashCurrency })] : []);
const configuredAssets = [nativeHistoryAsset(), ...registryAssets,
  ...portfolioVaults.map((vault) => contractHistoryAsset(vault.address, { decimals: vault.decimals })),
  ...BORROW_MARKETS.flatMap((market) => morphoHistoryAssets(market.marketId))];
const registryKeys: ReadonlySet<string> = new Set(registryAssets.map((asset) => asset.key));
const BACKFILL_CHUNK_BLOCKS = BigInt(31 * 43_200);

type Report = {
  status: "not-enrolled" | "building" | "ready";
  backfillComplete: boolean;
  queries: number;
  windows: number;
  reads: number;
  conflicts: number;
};

function uniqueAssets(assets: readonly HistoryAsset[]): HistoryAsset[] {
  const unique = new Map<string, HistoryAsset>();
  for (const asset of assets) {
    const prior = unique.get(asset.key);
    unique.set(asset.key, asset.contractAddress
      ? contractHistoryAsset(asset.contractAddress, {
        kind: prior?.kind === "vault-share" || asset.kind === "vault-share" ? "vault-share" : asset.kind,
        decimals: prior?.decimals ?? asset.decimals,
        cashCurrency: prior?.cashCurrency ?? asset.cashCurrency,
      })
      : asset);
  }
  return [...unique.values()];
}

function cumulative(input: Awaited<ReturnType<HistoryStore["sumChanges"]>>, key: string, index: number): { sum: bigint; count: number } {
  const row = input.find((entry) => entry.asset.key === key);
  return { sum: row?.sums[index] ?? BigInt(0), count: row?.counts[index] ?? 0 };
}

function isTransferLogged(asset: HistoryAsset): asset is TransferLoggedAsset {
  return asset.kind === "erc20" || asset.kind === "vault-share";
}

export function createHistoryIngest(deps: {
  store: HistoryStore;
  source: HistoryTransferSource;
  chain: HistoryChainReader;
  now?: () => Date;
  lagBlocks?: bigint;
  replayBlocks?: bigint;
}) {
  const { store, source, chain, now = () => new Date(), lagBlocks = HISTORY_INGEST_LAG_BLOCKS, replayBlocks = HISTORY_REPLAY_BLOCKS } = deps;
  const watermark = (head: BlockRef, floor: bigint) => {
    const target = head.number - lagBlocks;
    return target > floor ? target : floor;
  };
  return {
    async enroll(address: HexAddress, signal?: AbortSignal) {
      const existing = await store.getAddress(HISTORY_CHAIN_ID, address);
      if (existing) return existing;
      const head = await chain.finalizedHead(signal);
      const seconds = Math.floor((head.timestamp - HISTORY_WINDOW_SECONDS) / 86_400) * 86_400;
      const windowStartAt = new Date(seconds * 1000);
      const cached = await store.getBuckets(HISTORY_CHAIN_ID, [windowStartAt]);
      const buckets = cached.length ? cached : await chain.resolveBuckets([windowStartAt], head, signal);
      if (buckets.length !== 1) throw new Error("History window-start block unavailable");
      if (!cached.length) await store.putBuckets(HISTORY_CHAIN_ID, buckets);
      return store.enroll({ chainId: HISTORY_CHAIN_ID, address, windowStartBlock: buckets[0].blockNumber,
        windowStartAt, enrolledBlock: watermark(head, buckets[0].blockNumber) });
    },

    async run(address: HexAddress, input: { heldAssets: HistoryAsset[]; deadline: number; signal?: AbortSignal }): Promise<Report> {
      const startedAt = now();
      const report: Report = { status: "building", backfillComplete: false, queries: 0, reads: 0, windows: 0, conflicts: 0 };
      const enrolled = await store.getAddress(HISTORY_CHAIN_ID, address);
      if (!enrolled) return { ...report, status: "not-enrolled" };
      let row = enrolled;
      const deadlineSignal = AbortSignal.timeout(Math.max(0, input.deadline - startedAt.getTime()));
      const signal = input.signal ? AbortSignal.any([input.signal, deadlineSignal]) : deadlineSignal;
      const cutoff = input.deadline - (input.deadline - startedAt.getTime() >= 1000 ? 1000 : 0);
      const timeLeft = () => !signal.aborted && now().getTime() < cutoff;
      const checkAbort = () => { if (signal.aborted) throw signal.reason; };
      try {
      const head = await chain.finalizedHead(signal);
      checkAbort();
      const blockTime = (block: bigint) => new Date((head.timestamp - Number(head.number - block) * 2) * 1000);
      const target = watermark(head, row.windowStartBlock);
      if (replayBlocks > BigInt(0)) {
        const replay = async (fromBlockExclusive: bigint, toBlockInclusive: bigint) => {
          let result;
          try {
            result = await source.listChanges({ address, fromBlockExclusive, toBlockInclusive,
              fromTime: blockTime(fromBlockExclusive), toTime: blockTime(toBlockInclusive), signal });
          } catch (error) {
            if (input.signal?.aborted) throw error;
            return false;
          }
          checkAbort();
          report.queries += result.queries;
          report.windows += result.windows;
          await store.appendReplayChanges({ addressId: row.id, changes: result.changes, invalidateAboveBlock: fromBlockExclusive });
          return true;
        };
        if (row.forwardBlock > row.windowStartBlock && timeLeft()) {
          const start = row.forwardBlock - replayBlocks > row.windowStartBlock
            ? row.forwardBlock - replayBlocks : row.windowStartBlock;
          if (start < row.forwardBlock && !await replay(start, row.forwardBlock)) return report;
        }
        if (row.backfillBlock < row.enrolledBlock && timeLeft()) {
          const end = row.backfillBlock + replayBlocks < row.enrolledBlock
            ? row.backfillBlock + replayBlocks : row.enrolledBlock;
          if (end > row.backfillBlock && !await replay(row.backfillBlock > BigInt(0) ? row.backfillBlock - BigInt(1) : BigInt(0), end)) return report;
        }
      }
      while (row.backfillBlock > row.windowStartBlock && timeLeft()) {
        const chunkStart = row.backfillBlock - BACKFILL_CHUNK_BLOCKS > row.windowStartBlock
          ? row.backfillBlock - BACKFILL_CHUNK_BLOCKS
          : row.windowStartBlock;
        let result;
        try {
          result = await source.listChanges({ address, fromBlockExclusive: chunkStart,
            toBlockInclusive: row.backfillBlock, fromTime: blockTime(chunkStart),
            toTime: blockTime(row.backfillBlock), signal });
        } catch (error) {
          if (input.signal?.aborted) throw error;
          return report;
        }
        checkAbort();
        report.queries += result.queries;
        report.windows += result.windows;
        const committed = await store.commitBackfillChunk({ addressId: row.id, expectedBackfillBlock: row.backfillBlock,
          nextBackfillBlock: chunkStart, changes: result.changes });
        if (committed === "conflict") report.conflicts++;
        const previous = row.backfillBlock;
        row = (await store.getAddress(HISTORY_CHAIN_ID, address)) ?? row;
        if (committed === "conflict" && row.backfillBlock === previous) break;
      }
      report.backfillComplete = row.backfillBlock === row.windowStartBlock;
      if (timeLeft()) {
        while (target > row.forwardBlock && timeLeft()) {
          let result;
          try {
            result = await source.listChanges({ address, fromBlockExclusive: row.forwardBlock,
              toBlockInclusive: target, fromTime: blockTime(row.forwardBlock),
              toTime: blockTime(target), signal });
          } catch (error) {
            if (input.signal?.aborted) throw error;
            return report;
          }
          checkAbort();
          report.queries += result.queries;
          report.windows += result.windows;
          const committed = await store.commitForwardChunk({ addressId: row.id, expectedForwardBlock: row.forwardBlock,
            nextForwardBlock: target, changes: result.changes, ingestedAt: now(), clearDirtyObservedBefore: startedAt });
          if (committed === "conflict") report.conflicts++;
          const previous = row.forwardBlock;
          row = (await store.getAddress(HISTORY_CHAIN_ID, address)) ?? row;
          if (committed === "conflict" && row.forwardBlock === previous) break;
        }
      }
      const assets = uniqueAssets([...await store.listTrackedAssets(row.id), ...input.heldAssets, ...configuredAssets]);
      await store.putAssets(HISTORY_CHAIN_ID, assets);
      let checkpoints = await store.listCheckpoints(row.id);
      if (report.backfillComplete && timeLeft()) {
        const missing = assets.filter((asset) => !checkpoints.some((point) => point.asset.key === asset.key &&
          point.blockNumber === row.windowStartBlock && point.purpose === "window-start"));
        if (missing.length) {
          const quantities = await chain.readQuantities({ address, assets: missing, block: row.windowStartBlock, signal });
          checkAbort();
          report.reads++;
          await store.putCheckpoints(row.id, missing.flatMap((asset): BalanceCheckpoint[] => {
            const value = quantities.get(asset.key);
            return value?.status === "ready" ? [{ asset, blockNumber: row.windowStartBlock, purpose: "window-start",
              chainQuantity: value.baseUnits, logQuantity: null, observedAt: now() }] : [];
          }));
          checkpoints = await store.listCheckpoints(row.id);
        }
      }
      const anchored = assets.filter((asset) => checkpoints.some((point) => point.asset.key === asset.key &&
        point.blockNumber === row.windowStartBlock && point.purpose === "window-start"));
      const compared = new Set(checkpoints.filter((point) => point.blockNumber > row.windowStartBlock &&
        (point.purpose === "reconcile" && point.logQuantity !== null || point.asset.kind.startsWith("morpho-") && point.purpose === "bucket"))
        .map((point) => point.asset.key));
      const pendingComparisons = new Set(checkpoints.filter((point) => point.blockNumber > row.windowStartBlock &&
        point.purpose === "reconcile" && point.logQuantity === null).map((point) => point.asset.key));
      if (report.backfillComplete && anchored.length && row.forwardBlock > row.windowStartBlock && timeLeft()) {
        const verifiedAt = (asset: HistoryAsset) => checkpoints
          .filter((point) => point.asset.key === asset.key && point.blockNumber > row.windowStartBlock &&
            (point.purpose === "reconcile" && point.logQuantity !== null || asset.kind.startsWith("morpho-") && point.purpose === "bucket"))
          .reduce<bigint | null>((last, point) => last === null || point.blockNumber > last ? point.blockNumber : last, null);
        const due = anchored.filter((asset) => {
          const at = verifiedAt(asset);
          const pending = checkpoints.some((point) => point.asset.key === asset.key && point.blockNumber > row.windowStartBlock &&
            point.purpose === "reconcile" && point.logQuantity === null);
          return pending || at === null || (row.forwardBlock - at) * BigInt(2) >= BigInt(HISTORY_RECONCILE_INTERVAL_SECONDS);
        });
        if (due.length) {
          const existing = new Map(checkpoints.filter((point) => point.blockNumber === row.forwardBlock)
            .map((point) => [point.asset.key, point.chainQuantity]));
          const missing = due.filter((asset) => !existing.has(asset.key));
          const quantities = missing.length
            ? await chain.readQuantities({ address, assets: missing, block: row.forwardBlock, signal })
            : new Map<HistoryAssetKey, QuantityRead>();
          checkAbort();
          if (missing.length) report.reads++;
          const ready = due.flatMap((asset) => {
            const value = quantities.get(asset.key);
            const chainQuantity = existing.get(asset.key) ?? (value?.status === "ready" ? value.baseUnits : null);
            if (chainQuantity === null) return [];
            const anchor = checkpoints.find((point) => point.asset.key === asset.key && point.blockNumber === row.windowStartBlock)!;
            return [{ asset, chainQuantity, anchorQuantity: anchor.chainQuantity }];
          });
          await store.putCheckpoints(row.id, ready.filter((point) => !isTransferLogged(point.asset)).map((point): BalanceCheckpoint => ({
            asset: point.asset, blockNumber: row.forwardBlock, purpose: point.asset.kind.startsWith("morpho-") ? "bucket" : "reconcile",
            chainQuantity: point.chainQuantity, logQuantity: point.asset.kind === "native" ? point.anchorQuantity : null, observedAt: now(),
          })));
          await store.putReconcileCheckpoints({ addressId: row.id, windowStartBlock: row.windowStartBlock,
            checkpoints: ready.filter((point): point is typeof point & { asset: TransferLoggedAsset } => isTransferLogged(point.asset))
              .map((point) => ({ ...point, blockNumber: row.forwardBlock, observedAt: now() })) });
          ready.forEach((point) => { compared.add(point.asset.key); pendingComparisons.delete(point.asset.key); });
        }
      }
      checkAbort();
      const unverified = anchored.filter((asset) => !isStaticArchiveRead(asset) && !compared.has(asset.key));
      report.status = report.backfillComplete && row.forwardBlock >= target && anchored.length === assets.length &&
        unverified.length === 0 && pendingComparisons.size === 0 ? "ready" : "building";
      return report;
      } catch (error) {
        if (deadlineSignal.aborted && !input.signal?.aborted) return report;
        throw error;
      }
    },

    async readQuantities(address: HexAddress, input: { buckets: ChainBucket[]; maxArchiveReads: number; heldAssets: readonly HistoryAsset[]; signal?: AbortSignal }) {
      const row = await store.getAddress(HISTORY_CHAIN_ID, address);
      if (!row) return [];
      if (!Number.isSafeInteger(input.maxArchiveReads) || input.maxArchiveReads < 0) throw new RangeError("Invalid archive read limit");
      const assets = uniqueAssets([...await store.listTrackedAssets(row.id), ...input.heldAssets]);
      const sorted = [...input.buckets].sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0);
      const blocks = [...new Set(sorted.filter((bucket) => bucket.blockNumber > row.windowStartBlock).map((bucket) => bucket.blockNumber))];
      const { checkpoints, sums, checkpointSums } = await store.readIngestSnapshot({
        addressId: row.id, fromBlockExclusive: row.windowStartBlock, changeBoundaries: blocks,
      });
      const checkpointBlocks = [...new Set(checkpoints.filter((point) => point.blockNumber > row.windowStartBlock)
        .map((point) => point.blockNumber))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const nativeEverHeld = input.heldAssets.some((asset) => asset.kind === "native");
      const derived = assets.map((asset) => {
        const points = checkpoints.filter((point) => point.asset.key === asset.key);
        const segments = deriveTracking({ asset, registry: registryKeys.has(asset.key), windowStartBlock: row.windowStartBlock,
          nativeEverHeld,
          checkpoints: points, cumulativeChangeCounts: points.map((point) => point.blockNumber <= row.windowStartBlock ? 0 :
            cumulative(checkpointSums, asset.key, checkpointBlocks.indexOf(point.blockNumber)).count) });
        return { asset, points, segments };
      });
      const needs = new Map<bigint, HistoryAsset[]>();
      for (const { asset, points, segments } of derived) {
        if (!points.some((point) => point.blockNumber === row.windowStartBlock && point.purpose === "window-start")) continue;
        for (const block of blocks) {
          const method = segments.find((segment) => segment.fromBlock <= block && (segment.toBlock === null || block < segment.toBlock))?.method;
          if ((method === "archive-read" || method === "position-index") && !points.some((point) => point.blockNumber === block)) {
            needs.set(block, [...needs.get(block) ?? [], asset]);
          }
        }
      }
      const newest = [...needs.keys()].sort((a, b) => a > b ? -1 : a < b ? 1 : 0).slice(0, input.maxArchiveReads);
      for (const block of newest) {
        const missing = needs.get(block)!;
        const quantities = await chain.readQuantities({ address, assets: missing, block, signal: input.signal });
        await store.putCheckpoints(row.id, missing.flatMap((asset): BalanceCheckpoint[] => {
          const value = quantities.get(asset.key);
          return value?.status === "ready" ? [{ asset, blockNumber: block, purpose: "bucket",
            chainQuantity: value.baseUnits, logQuantity: null, observedAt: now() }] : [];
        }));
      }
      const updated = newest.length ? await store.listCheckpoints(row.id) : checkpoints;
      return derived.map(({ asset, segments }) => {
        const points = updated.filter((point) => point.asset.key === asset.key);
        const anchor = points.find((point) => point.blockNumber === row.windowStartBlock && point.purpose === "window-start");
        const reads = new Map(points.map((point) => [point.blockNumber, point.chainQuantity]));
        const quantities = resolveBucketQuantities({ segments, windowStartBlock: row.windowStartBlock,
          anchor: anchor?.chainQuantity ?? null, bucketBlocks: sorted.map((bucket) => bucket.blockNumber),
          cumulativeSums: sorted.map((bucket) => bucket.blockNumber <= row.windowStartBlock ? BigInt(0) :
            cumulative(sums, asset.key, blocks.indexOf(bucket.blockNumber)).sum), archiveReads: reads });
        for (const [index, bucket] of sorted.entries()) {
          if (bucket.blockNumber <= row.forwardBlock) continue;
          const method = segments.find((segment) => segment.fromBlock <= bucket.blockNumber &&
            (segment.toBlock === null || bucket.blockNumber < segment.toBlock))?.method;
          if (method === "transfer-log" || method === "shares-rate") {
            quantities[index] = { blockNumber: bucket.blockNumber, status: "unavailable", reason: "pending-read" };
          }
        }
        const byBucket = new Map(sorted.map((bucket, index) => [bucket, quantities[index]]));
        return { asset, segments, buckets: input.buckets.map((bucket) => ({ bucket, quantity: byBucket.get(bucket)! })) };
      });
    },
  };
}
