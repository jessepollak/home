import "server-only";

import type { Erc20AssetKey, NativeAssetKey } from "@/shared/balances/types";
import type { FiatCurrencyCode } from "@/config/regions";

export const HISTORY_CHAIN_ID = 8453 as const;
export const HISTORY_WINDOW_SECONDS = 365 * 86_400;
export const HISTORY_HOURLY_RETENTION_SECONDS = 8 * 86_400;
export const HISTORY_RECONCILE_INTERVAL_SECONDS = 30 * 86_400;
export const HISTORY_INGEST_LAG_BLOCKS = BigInt(900);
export const HISTORY_REPLAY_BLOCKS = BigInt(900);
export const HISTORY_BUCKET_SECONDS = 3_600;
export const HISTORY_DAY_SECONDS = 86_400;

export type HexAddress = `0x${string}`;
export type HexHash = `0x${string}`;

export type MorphoHistoryAssetKey =
  | `morpho:${string}:collateral`
  | `morpho:${string}:borrow-shares`;
export type HistoryAssetKey = NativeAssetKey | Erc20AssetKey | MorphoHistoryAssetKey;

export type HistoryAssetHints = { decimals?: number; cashCurrency?: FiatCurrencyCode | null };

export type HistoryAsset =
  | { key: NativeAssetKey; kind: "native"; contractAddress: null; marketId: null } & HistoryAssetHints
  | { key: Erc20AssetKey; kind: "erc20" | "vault-share"; contractAddress: HexAddress; marketId: null } & HistoryAssetHints
  | {
    key: MorphoHistoryAssetKey;
    kind: "morpho-collateral" | "morpho-borrow-shares";
    contractAddress: null;
    marketId: HexHash;
  } & HistoryAssetHints;

export type TransferLoggedAsset = Extract<HistoryAsset, { kind: "erc20" | "vault-share" }>;

export type TrackingMethod =
  | "transfer-log"
  | "archive-read"
  | "shares-rate"
  | "position-index"
  | "unsupported";

export type BlockRef = { number: bigint; hash: HexHash; timestamp: number };

export type HistoryAddress = {
  id: number;
  chainId: number;
  address: HexAddress;
  windowStartBlock: bigint;
  windowStartAt: Date;
  enrolledBlock: bigint;
  backfillBlock: bigint;
  forwardBlock: bigint;
  dirtyAt: Date | null;
  ingestedAt: Date | null;
};

export type BalanceChange = {
  asset: TransferLoggedAsset;
  blockNumber: bigint;
  logIndex: number;
  blockTime: Date;
  txHash: HexHash | null;
  delta: bigint;
};

export type CheckpointPurpose = "window-start" | "reconcile" | "bucket";

export type BalanceCheckpoint = {
  asset: HistoryAsset;
  blockNumber: bigint;
  purpose: CheckpointPurpose;
  chainQuantity: bigint;
  logQuantity: bigint | null;
  observedAt: Date;
};

export type ChainBucket = {
  bucketAt: Date;
  blockNumber: bigint;
  blockHash: HexHash;
  blockTime: Date;
};

export type Granularity = "1h" | "1d";

export type SeriesValue = { atoms: bigint; scale: number };

export type ValuationPoint = {
  seriesKey: string;
  basisVersion: string;
  granularity: Granularity;
  bucketAt: Date;
  value: SeriesValue | null;
  blockNumber: bigint | null;
  source: string;
  observedAt: Date;
};

export type ChangeSums = {
  asset: TransferLoggedAsset;
  sums: bigint[];
  counts: number[];
};

export type ChunkCommit = "committed" | "conflict";

export interface HistoryStore {
  enroll(input: {
    chainId: number;
    address: HexAddress;
    windowStartBlock: bigint;
    windowStartAt: Date;
    enrolledBlock: bigint;
  }): Promise<HistoryAddress | null>;
  getAddress(chainId: number, address: HexAddress): Promise<HistoryAddress | null>;
  markDirty(chainId: number, addresses: readonly HexAddress[], at: Date): Promise<number>;
  appendReplayChanges(input: { addressId: number; changes: readonly BalanceChange[]; invalidateAboveBlock: bigint }): Promise<number>;
  commitBackfillChunk(input: {
    addressId: number;
    expectedBackfillBlock: bigint;
    nextBackfillBlock: bigint;
    changes: readonly BalanceChange[];
  }): Promise<ChunkCommit>;
  commitForwardChunk(input: {
    addressId: number;
    expectedForwardBlock: bigint;
    nextForwardBlock: bigint;
    changes: readonly BalanceChange[];
    ingestedAt: Date;
    clearDirtyObservedBefore: Date | null;
  }): Promise<ChunkCommit>;
  putCheckpoints(addressId: number, checkpoints: readonly BalanceCheckpoint[]): Promise<void>;
  putReconcileCheckpoints(input: { addressId: number; windowStartBlock: bigint; checkpoints: readonly {
    asset: TransferLoggedAsset; blockNumber: bigint; chainQuantity: bigint; anchorQuantity: bigint; observedAt: Date;
  }[] }): Promise<void>;
  listCheckpoints(addressId: number): Promise<BalanceCheckpoint[]>;
  readIngestSnapshot(input: {
    addressId: number;
    fromBlockExclusive: bigint;
    changeBoundaries: readonly bigint[];
  }): Promise<{ checkpoints: BalanceCheckpoint[]; sums: ChangeSums[]; checkpointSums: ChangeSums[] }>;
  putAssets(chainId: number, assets: readonly HistoryAsset[]): Promise<void>;
  listTrackedAssets(addressId: number): Promise<HistoryAsset[]>;
  sumChanges(input: {
    addressId: number;
    fromBlockExclusive: bigint;
    boundaries: readonly bigint[];
  }): Promise<ChangeSums[]>;
  getBuckets(chainId: number, bucketTimes: readonly Date[]): Promise<ChainBucket[]>;
  putBuckets(chainId: number, buckets: readonly ChainBucket[]): Promise<void>;
  getValuationPoints(input: {
    seriesKeys: readonly string[];
    basisVersion: string;
    granularity: Granularity;
    bucketTimes: readonly Date[];
  }): Promise<ValuationPoint[]>;
  putValuationPoints(points: readonly ValuationPoint[]): Promise<void>;
  pruneHourlyValuationPoints(olderThan: Date, batchSize: number): Promise<number>;
}

export type TransferSourceResult = {
  changes: BalanceChange[];
  queries: number;
  windows: number;
};

export interface HistoryTransferSource {
  listChanges(input: {
    address: HexAddress;
    fromBlockExclusive: bigint;
    toBlockInclusive: bigint;
    fromTime: Date;
    toTime: Date;
    signal?: AbortSignal;
  }): Promise<TransferSourceResult>;
}

export type QuantityRead =
  | { status: "ready"; baseUnits: bigint }
  | { status: "unavailable" };

export type VaultRateRead = { vault: HexAddress; value: SeriesValue | null };
export type MorphoIndexRead = { marketId: HexHash; value: SeriesValue | null };

export interface HistoryChainReader {
  finalizedHead(signal?: AbortSignal): Promise<BlockRef>;
  resolveBuckets(bucketTimes: readonly Date[], finalized: BlockRef, signal?: AbortSignal): Promise<ChainBucket[]>;
  readQuantities(input: {
    address: HexAddress;
    assets: readonly HistoryAsset[];
    block: bigint;
    signal?: AbortSignal;
  }): Promise<Map<HistoryAssetKey, QuantityRead>>;
  readVaultRates(input: {
    vaults: readonly HexAddress[];
    block: bigint;
    signal?: AbortSignal;
  }): Promise<VaultRateRead[]>;
  readMorphoBorrowIndexes(input: {
    marketIds: readonly HexHash[];
    block: bigint;
    blockTimestamp: number;
    signal?: AbortSignal;
  }): Promise<MorphoIndexRead[]>;
}
