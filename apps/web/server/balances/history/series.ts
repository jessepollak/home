import "server-only";

import type { FiatCurrencyCode } from "@/config/regions";
import {
  dailyFxKey,
  type DailyFxReader,
  type DailyFxRequest,
  type DailyFxResult,
} from "@/server/activity/valuation/coinbase-daily-fx";
import {
  historicalCloseKey,
  type HistoricalCloseReader,
  type HistoricalCloseRequest,
  type HistoricalCloseResult,
} from "@/server/activity/valuation/codex-closes";
import {
  HISTORY_CHAIN_ID,
  HISTORY_HOURLY_RETENTION_SECONDS,
  type BlockRef,
  type ChainBucket,
  type Granularity,
  type HexAddress,
  type HexHash,
  type HistoryChainReader,
  type HistoryStore,
  type SeriesValue,
  type ValuationPoint,
} from "./types";

type HistorySeriesResult =
  | { status: "ready"; value: SeriesValue; provisional: boolean }
  | { status: "none" }
  | { status: "unavailable" };

export type HistorySeriesLookup = Map<string, Map<number, HistorySeriesResult>>;

const BASIS_VERSION = "history-basis-v1";
const CLOSE_SETTLE_MS = (3_600 + 15 * 60) * 1_000;
const UNAVAILABLE = { status: "unavailable" } as const;

type Missing = { seriesKey: string; bucket: ChainBucket };

export function createHistorySeries(deps: {
  store: HistoryStore;
  chain: HistoryChainReader;
  readCloses: HistoricalCloseReader;
  readFx: DailyFxReader;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function ensureBuckets(bucketTimes: readonly Date[], finalized: BlockRef, signal?: AbortSignal): Promise<ChainBucket[]> {
    const eligible = [...new Map(bucketTimes
      .filter((time) => time.getTime() <= finalized.timestamp * 1_000)
      .map((time) => [time.getTime(), time] as const)).values()];
    if (eligible.length === 0) return [];
    const stored = await deps.store.getBuckets(HISTORY_CHAIN_ID, eligible);
    const byTime = new Map(stored.map((bucket) => [bucket.bucketAt.getTime(), bucket]));
    const missing = eligible.filter((time) => !byTime.has(time.getTime()));
    if (missing.length > 0) {
      const resolved = await deps.chain.resolveBuckets(missing, finalized, signal);
      if (resolved.length > 0) await deps.store.putBuckets(HISTORY_CHAIN_ID, resolved);
      for (const bucket of resolved) byTime.set(bucket.bucketAt.getTime(), bucket);
    }
    return eligible.flatMap((time) => {
      const bucket = byTime.get(time.getTime());
      return bucket ? [bucket] : [];
    });
  }

  async function fill(input: {
    buckets: readonly ChainBucket[];
    granularity: Granularity;
    vaults: readonly HexAddress[];
    marketIds: readonly HexHash[];
    closeContracts: readonly HexAddress[];
    fxCurrencies: readonly FiatCurrencyCode[];
    signal?: AbortSignal;
  }): Promise<HistorySeriesLookup> {
    const observedAt = now();
    await deps.store.pruneHourlyValuationPoints(
      new Date(observedAt.getTime() - HISTORY_HOURLY_RETENTION_SECONDS * 1_000),
      500,
    );
    const buckets = [...new Map(input.buckets.map((bucket) => [bucket.bucketAt.getTime(), bucket])).values()];
    const vaultKeys = [...new Set(input.vaults.map((vault) => vault.toLowerCase() as HexAddress))];
    const marketKeys = [...new Set(input.marketIds.map((market) => market.toLowerCase() as HexHash))];
    const closeKeys = [...new Set(input.closeContracts.map((contract) => contract.toLowerCase() as HexAddress))];
    const currencies = [...new Set(input.fxCurrencies)];
    const seriesKeys = [
      ...vaultKeys.map((vault) => `vault-rate:${vault}`),
      ...marketKeys.map((market) => `morpho-borrow-index:${market}`),
      ...closeKeys.map((contract) => `close:${contract}`),
      ...currencies.filter((currency) => currency !== "USD").map((currency) => `fx:USD:${currency}`),
    ];
    const lookup: HistorySeriesLookup = new Map();
    const pending: ValuationPoint[] = [];
    const set = (key: string, bucket: ChainBucket, result: HistorySeriesResult) => {
      let byTime = lookup.get(key);
      if (!byTime) {
        byTime = new Map();
        lookup.set(key, byTime);
      }
      byTime.set(bucket.bucketAt.getTime(), result);
    };
    const record = (entry: Missing, result: HistorySeriesResult, source: string, blockNumber: bigint | null, settled: boolean) => {
      set(entry.seriesKey, entry.bucket, result);
      if (!settled || result.status === "unavailable") return;
      pending.push({
        seriesKey: entry.seriesKey,
        basisVersion: BASIS_VERSION,
        granularity: input.granularity,
        bucketAt: entry.bucket.bucketAt,
        value: result.status === "ready" ? result.value : null,
        blockNumber,
        source,
        observedAt,
      });
    };

    if (currencies.includes("USD")) {
      for (const bucket of buckets) set("fx:USD:USD", bucket, { status: "ready", value: { atoms: BigInt(1), scale: 0 }, provisional: false });
    }
    const stored = seriesKeys.length > 0 && buckets.length > 0
      ? await deps.store.getValuationPoints({
        seriesKeys, basisVersion: BASIS_VERSION, granularity: input.granularity,
        bucketTimes: buckets.map((bucket) => bucket.bucketAt),
      })
      : [];
    const requested = new Set(seriesKeys);
    const byBucket = new Map(buckets.map((bucket) => [bucket.bucketAt.getTime(), bucket]));
    for (const point of stored) {
      const bucket = byBucket.get(point.bucketAt.getTime());
      if (bucket && requested.has(point.seriesKey)) {
        set(point.seriesKey, bucket, point.value
          ? { status: "ready", value: point.value, provisional: false }
          : { status: "none" });
      }
    }

    const missing = (keys: readonly string[]): Missing[] => buckets.flatMap((bucket) => keys
      .filter((key) => !lookup.get(key)?.has(bucket.bucketAt.getTime()))
      .map((seriesKey) => ({ seriesKey, bucket })));
    const chainMissing = missing(seriesKeys.filter((key) => key.startsWith("vault-rate:") || key.startsWith("morpho-borrow-index:")));
    const grouped = new Map<number, { bucket: ChainBucket; vaults: HexAddress[]; markets: HexHash[] }>();
    for (const entry of chainMissing) {
      const timestamp = entry.bucket.bucketAt.getTime();
      let group = grouped.get(timestamp);
      if (!group) {
        group = { bucket: entry.bucket, vaults: [], markets: [] };
        grouped.set(timestamp, group);
      }
      if (entry.seriesKey.startsWith("vault-rate:")) group.vaults.push(entry.seriesKey.slice(11) as HexAddress);
      else group.markets.push(entry.seriesKey.slice(20) as HexHash);
    }
    const jobs = [...grouped.values()];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) break;
        const { bucket } = job;
        const [rates, indexes] = await Promise.all([
          job.vaults.length > 0
            ? deps.chain.readVaultRates({ vaults: job.vaults, block: bucket.blockNumber, signal: input.signal }).catch(() => [])
            : [],
          job.markets.length > 0
            ? deps.chain.readMorphoBorrowIndexes({
              marketIds: job.markets, block: bucket.blockNumber,
              blockTimestamp: Math.floor(bucket.blockTime.getTime() / 1_000), signal: input.signal,
            }).catch(() => [])
            : [],
        ]);
        const vaultValues = new Map(rates.map((rate) => [rate.vault.toLowerCase(), rate.value]));
        const marketValues = new Map(indexes.map((index) => [index.marketId.toLowerCase(), index.value]));
        for (const vault of job.vaults) {
          const value = vaultValues.get(vault);
          record({ seriesKey: `vault-rate:${vault}`, bucket }, value
            ? { status: "ready", value, provisional: false } : UNAVAILABLE, "base-rpc", bucket.blockNumber, true);
        }
        for (const market of job.markets) {
          const value = marketValues.get(market);
          record({ seriesKey: `morpho-borrow-index:${market}`, bucket }, value
            ? { status: "ready", value, provisional: false } : UNAVAILABLE, "base-rpc", bucket.blockNumber, true);
        }
      }
    }));

    const closeMissing = missing(closeKeys.map((contract) => `close:${contract}`));
    const closeRequests: HistoricalCloseRequest[] = closeMissing.map(({ seriesKey, bucket }) => ({
      contract: seriesKey.slice(6) as HexAddress,
      timestampSeconds: Math.floor(bucket.bucketAt.getTime() / 1_000),
    }));
    const closes = closeRequests.length > 0
      ? await deps.readCloses(closeRequests, input.signal).catch(() => new Map<string, HistoricalCloseResult>())
      : new Map<string, HistoricalCloseResult>();
    closeMissing.forEach((entry, index) => {
      const request = closeRequests[index];
      if (!request) return;
      const close = closes.get(historicalCloseKey(request));
      const settled = entry.bucket.bucketAt.getTime() + CLOSE_SETTLE_MS <= observedAt.getTime();
      const result: HistorySeriesResult = close?.status === "found"
        ? { status: "ready", value: { atoms: BigInt(close.close.priceUsd.atoms), scale: close.close.priceUsd.scale }, provisional: !settled }
        : close?.status === "none" ? { status: "none" } : UNAVAILABLE;
      record(entry, result, "codex", null, settled);
    });

    const fxMissing = missing(currencies.filter((currency) => currency !== "USD").map((currency) => `fx:USD:${currency}`));
    const fxRequests = fxMissing.map(({ seriesKey, bucket }): DailyFxRequest => ({
      base: "USD", quote: seriesKey.slice(7) as FiatCurrencyCode,
      date: new Date(Math.floor(bucket.bucketAt.getTime() / 86_400_000) * 86_400_000 - 86_400_000).toISOString().slice(0, 10),
    }));
    const uniqueFxRequests = [...new Map(fxRequests.map((request) => [dailyFxKey(request), request])).values()];
    const rates = uniqueFxRequests.length > 0
      ? await deps.readFx(uniqueFxRequests, input.signal).catch(() => new Map<string, DailyFxResult>())
      : new Map<string, DailyFxResult>();
    fxMissing.forEach((entry, index) => {
      const request = fxRequests[index];
      if (!request) return;
      const fx = rates.get(dailyFxKey(request));
      const result: HistorySeriesResult = fx
        ? { status: "ready", value: { atoms: BigInt(fx.rate.atoms), scale: fx.rate.scale }, provisional: fx.provisional }
        : UNAVAILABLE;
      record(entry, result, "coinbase", null, result.status === "ready" && !result.provisional);
    });
    if (pending.length > 0) await deps.store.putValuationPoints(pending);
    return lookup;
  }

  return { ensureBuckets, fill };
}
