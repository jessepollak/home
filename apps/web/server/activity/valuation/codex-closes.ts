import "server-only";

import {
  executeCodexGraphql,
  readInteger,
  readRecord,
  type FetchLike,
} from "@/server/market-data/codex/execute";
import { createBoundedCache } from "@/server/cache/bounded";
import { createWriteOrder } from "@/server/cache/write-order";
import { parseExactDecimal } from "@/shared/balances/math";
import { readPositiveDecimal } from "@/shared/amounts/decimal";
import { ACTIVITY_BASE_CHAIN_ID } from "@/shared/activity/types";
import {
  ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES,
  ACTIVITY_VALUATION_BAR_SECONDS,
  ACTIVITY_VALUATION_MAX_CLOSE_GAP_SECONDS,
  type ActivityValuationClose,
} from "@/shared/activity/valuation";

export const ACTIVITY_CLOSE_BUCKET_SECONDS = 3_600;
export const ACTIVITY_CLOSE_TIMEOUT_MS = 3_000;
export const ACTIVITY_CLOSE_MAX_BUCKETS_PER_REQUEST = 25;
export const ACTIVITY_CLOSE_COUNTBACK_BARS = 8;
export const ACTIVITY_CLOSE_CACHE_MAX_ENTRIES = 2_048;
export const ACTIVITY_CLOSE_SETTLED_TTL_MS = 24 * 60 * 60 * 1_000;
export const ACTIVITY_CLOSE_STALE_RETENTION_MS = 7 * ACTIVITY_CLOSE_SETTLED_TTL_MS;
export const ACTIVITY_CLOSE_RECENT_TTL_MS = 60_000;
const SETTLE_MARGIN_SECONDS = 15 * 60;

export type HistoricalCloseRequest = {
  contract: `0x${string}`;
  timestampSeconds: number;
};

export type HistoricalCloseResult =
  | { status: "found"; close: ActivityValuationClose }
  | { status: "none" }
  | { status: "unavailable" };

export type HistoricalCloseReader = (
  requests: readonly HistoricalCloseRequest[],
  signal?: AbortSignal,
) => Promise<Map<string, HistoricalCloseResult>>;

type Bar = { startSeconds: number; close: string };
type Bucket = { contract: `0x${string}`; hour: number };
type CacheEntry = {
  storedAt: number;
  ttlMs: number;
  fetchedAtSeconds: number;
  bars: readonly Bar[];
};
type InFlight = { fetchedAtSeconds: number; bars: Promise<readonly Bar[] | null> };

export function historicalCloseKey(request: HistoricalCloseRequest): string {
  return `${request.contract.toLowerCase()}:${request.timestampSeconds}`;
}

export function historicalCloseBucketKey(bucket: Bucket): string {
  return `${ACTIVITY_BASE_CHAIN_ID}:${bucket.contract.toLowerCase()}:${bucket.hour}:USD`;
}

export function createCodexHistoricalCloseReader(options: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheMaxEntries?: number;
  writeOrder?: ReturnType<typeof createWriteOrder>;
}): HistoricalCloseReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? ACTIVITY_CLOSE_TIMEOUT_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? ACTIVITY_CLOSE_CACHE_MAX_ENTRIES;
  const writeOrder = options.writeOrder ?? createWriteOrder();
  const cache = createBoundedCache<CacheEntry>({
    maxEntries: cacheMaxEntries, ttlMs: ACTIVITY_CLOSE_STALE_RETENTION_MS, maxInFlight: 1,
    now: () => now().getTime(),
  });
  const inFlight = new Map<string, InFlight>();

  return async function readHistoricalCloses(requests) {
    const results = new Map<string, HistoricalCloseResult>();
    const apiKey = options.apiKey?.trim();
    const buckets = new Map<string, Bucket>();
    for (const request of requests) {
      const hour = Math.floor(request.timestampSeconds / ACTIVITY_CLOSE_BUCKET_SECONDS);
      const bucket = { contract: request.contract.toLowerCase() as `0x${string}`, hour };
      buckets.set(historicalCloseBucketKey(bucket), bucket);
    }

    const currentMs = now().getTime();
    const bars = new Map<string, readonly Bar[] | null>();
    const expired = new Map<string, CacheEntry>();
    const missing: [string, Bucket][] = [];
    for (const [key, bucket] of buckets) {
      const cached = cache.peek(key);
      if (cached && currentMs - cached.storedAt <= cached.ttlMs) {
        cache.get(key);
        bars.set(key, cached.bars);
      } else if (!apiKey) {
        bars.set(key, null);
      } else {
        if (cached) expired.set(key, cached);
        missing.push([key, bucket]);
      }
    }

    if (apiKey && missing.length > 0) {
      const pending = new Map<string, InFlight>();
      const toFetch: [string, Bucket][] = [];
      const currentBarEpoch = barEpoch(Math.floor(currentMs / 1_000));
      for (const [key, bucket] of missing) {
        const shared = inFlight.get(key);
        if (shared && barEpoch(shared.fetchedAtSeconds) === currentBarEpoch) {
          pending.set(key, shared);
        } else {
          toFetch.push([key, bucket]);
        }
      }
      for (let index = 0; index < toFetch.length; index += ACTIVITY_CLOSE_MAX_BUCKETS_PER_REQUEST) {
        const chunk = toFetch.slice(index, index + ACTIVITY_CLOSE_MAX_BUCKETS_PER_REQUEST);
        const fetchedAtSeconds = Math.floor(now().getTime() / 1_000);
        const request = fetchBuckets({ apiKey, chunk, fetchImpl, timeoutMs });
        chunk.forEach(([key, bucket], position) => {
          const single: InFlight = {
            fetchedAtSeconds,
            bars: writeOrder.settle(
              key,
              request.then(
                (values) => completedBars(values[position] ?? null, fetchedAtSeconds),
                () => null,
              ),
              (value) => {
                const storedAt = now().getTime();
                const settledBucket =
                  (bucket.hour + 1) * ACTIVITY_CLOSE_BUCKET_SECONDS + SETTLE_MARGIN_SECONDS <=
                  Math.floor(storedAt / 1_000);
                const ttlMs = value && value.length > 0 && settledBucket
                  ? ACTIVITY_CLOSE_SETTLED_TTL_MS
                  : recentTtlMs(fetchedAtSeconds, storedAt);
                if (value && ttlMs > 0) {
                  cache.set(key, { storedAt, ttlMs, fetchedAtSeconds, bars: value });
                  return true;
                }
                return false;
              },
            ),
          };
          inFlight.set(key, single);
          pending.set(key, single);
          const release = () => {
            if (inFlight.get(key) === single) inFlight.delete(key);
          };
          void single.bars.then(release, release);
        });
      }
      const settled = await Promise.all(
        [...pending].map(async ([key, entry]) =>
          [key, await entry.bars] as const),
      );
      for (const [key, value] of settled) {
        bars.set(key, value);
      }
    }

    for (const request of requests) {
      const hour = Math.floor(request.timestampSeconds / ACTIVITY_CLOSE_BUCKET_SECONDS);
      const key = historicalCloseBucketKey({ contract: request.contract, hour });
      const bucketBars = bars.get(key);
      const stale = bucketBars === null ? expired.get(key) : undefined;
      const eligibleStale = stale && stale.fetchedAtSeconds >=
        barEpoch(request.timestampSeconds) * ACTIVITY_VALUATION_BAR_SECONDS;
      const usableBars = eligibleStale ? stale.bars : bucketBars;
      results.set(
        historicalCloseKey(request),
        usableBars ? selectClose(usableBars, request.timestampSeconds) : { status: "unavailable" },
      );
    }
    return results;
  };
}

export function selectClose(
  bars: readonly Bar[],
  timestampSeconds: number,
): HistoricalCloseResult {
  let best: Bar | null = null;
  for (const bar of bars) {
    const closedAt = bar.startSeconds + ACTIVITY_VALUATION_BAR_SECONDS;
    if (closedAt > timestampSeconds) continue;
    if (!best || bar.startSeconds > best.startSeconds) best = bar;
  }
  if (!best) return { status: "none" };
  const closedAt = best.startSeconds + ACTIVITY_VALUATION_BAR_SECONDS;
  if (timestampSeconds - closedAt > ACTIVITY_VALUATION_MAX_CLOSE_GAP_SECONDS) {
    return { status: "none" };
  }
  const priceUsd = parseExactDecimal(best.close);
  if (!priceUsd || priceUsd.atoms === "0") return { status: "none" };
  return {
    status: "found",
    close: {
      provider: "Codex",
      closedAt: new Date(closedAt * 1_000).toISOString(),
      resolutionMinutes: ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES,
      priceUsd,
    },
  };
}

export function bucketWindow(hour: number): { from: number; to: number } {
  const start = hour * ACTIVITY_CLOSE_BUCKET_SECONDS;
  return {
    from: start - ACTIVITY_VALUATION_MAX_CLOSE_GAP_SECONDS - ACTIVITY_VALUATION_BAR_SECONDS,
    to: start + ACTIVITY_CLOSE_BUCKET_SECONDS,
  };
}

export function buildHistoricalCloseQuery(count: number): string {
  const variables: string[] = [];
  const fields: string[] = [];
  for (let index = 0; index < count; index += 1) {
    variables.push(`$s${index}: String!, $f${index}: Int!, $t${index}: Int!`);
    fields.push(
      `  b${index}: getBars(symbol: $s${index}, from: $f${index}, to: $t${index}, countback: ${ACTIVITY_CLOSE_COUNTBACK_BARS}, resolution: "${ACTIVITY_VALUATION_BAR_RESOLUTION_MINUTES}", currencyCode: "USD", removeEmptyBars: true, removeLeadingNullValues: true, symbolType: TOKEN) { t c s }`,
    );
  }
  return `query ActivityHistoricalCloses(${variables.join(", ")}) {\n${fields.join("\n")}\n}`;
}

async function fetchBuckets({
  apiKey,
  chunk,
  fetchImpl,
  timeoutMs,
}: {
  apiKey: string;
  chunk: readonly [string, Bucket][];
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<(readonly Bar[] | null)[]> {
  const variables: Record<string, unknown> = {};
  chunk.forEach(([, bucket], index) => {
    const window = bucketWindow(bucket.hour);
    variables[`s${index}`] = `${bucket.contract}:${ACTIVITY_BASE_CHAIN_ID}`;
    variables[`f${index}`] = window.from;
    variables[`t${index}`] = window.to;
  });
  const data = readRecord(await executeCodexGraphql({
    apiKey,
    query: buildHistoricalCloseQuery(chunk.length),
    variables,
    fetchImpl,
    timeoutMs,
    allowPartialData: true,
  }));
  return chunk.map((_, index) => normalizeBars(data?.[`b${index}`]));
}

function barEpoch(seconds: number): number {
  return Math.floor(seconds / ACTIVITY_VALUATION_BAR_SECONDS);
}

function recentTtlMs(fetchedAtSeconds: number, storedAtMs: number): number {
  const nextCloseSeconds =
    (Math.floor(fetchedAtSeconds / ACTIVITY_VALUATION_BAR_SECONDS) + 1) *
    ACTIVITY_VALUATION_BAR_SECONDS;
  return Math.min(ACTIVITY_CLOSE_RECENT_TTL_MS, nextCloseSeconds * 1_000 - storedAtMs);
}

function completedBars(
  bars: readonly Bar[] | null,
  fetchedAtSeconds: number,
): readonly Bar[] | null {
  return bars
    ? bars.filter((bar) => bar.startSeconds + ACTIVITY_VALUATION_BAR_SECONDS <= fetchedAtSeconds)
    : null;
}

export function normalizeBars(value: unknown): readonly Bar[] | null {
  const bars = readRecord(value);
  if (!bars) return null;
  if (bars.s === "no_data") return [];
  if (
    bars.s !== "ok" ||
    !Array.isArray(bars.t) ||
    !Array.isArray(bars.c) ||
    bars.t.length !== bars.c.length
  ) {
    return null;
  }
  const result: Bar[] = [];
  for (let index = 0; index < bars.t.length; index += 1) {
    const startSeconds = readInteger(bars.t[index]);
    if (startSeconds === null) return null;
    if (bars.c[index] === null) continue;
    const close = readPositiveDecimal(bars.c[index]);
    if (!close) return null;
    result.push({ startSeconds, close });
  }
  return result;
}
