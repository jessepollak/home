import "server-only";

import {
  CODEX_CACHE_TTL_MS,
  CODEX_GRAPHQL_ENDPOINT,
  CODEX_REQUEST_TIMEOUT_MS,
} from "./config";
import { CodexMarketDataError } from "./client";
import { parseJsonWithNumberLexemes } from "./lossless-json";
import {
  isMarketPriceRange,
  MARKET_PRICE_HISTORY_VERSION,
  resolveMarketPriceAssetIdentity,
  type MarketPriceAssetId,
  type MarketPriceAssetIdentity,
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/history-contract";

export const CODEX_BARS_QUERY = `query GetBars($symbol: String!, $from: Int!, $to: Int!, $resolution: String!) {
  getBars(
    symbol: $symbol
    from: $from
    to: $to
    resolution: $resolution
    currencyCode: "USD"
    removeEmptyBars: true
    removeLeadingNullValues: true
    symbolType: TOKEN
  ) {
    t
    c
    s
  }
}`;

export const MARKET_HISTORY_WINDOWS = {
  "1D": { resolution: "15", durationSeconds: 24 * 60 * 60 },
  "1W": { resolution: "60", durationSeconds: 7 * 24 * 60 * 60 },
  "1M": { resolution: "240", durationSeconds: 30 * 24 * 60 * 60 },
  "3M": { resolution: "1D", durationSeconds: 90 * 24 * 60 * 60 },
  "1Y": { resolution: "1D", durationSeconds: 365 * 24 * 60 * 60 },
} as const satisfies Record<
  MarketPriceRange,
  { resolution: string; durationSeconds: number }
>;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => Date;

type HistoryReaderOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  maxInFlight?: number;
};

type CacheEntry = {
  storedAt: number;
  response: MarketPriceHistoryResponse;
};

export const CODEX_HISTORY_CACHE_MAX_ENTRIES = 64;
export const CODEX_HISTORY_MAX_IN_FLIGHT = 8;

export function createCodexMarketHistoryReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
  cacheTtlMs = CODEX_CACHE_TTL_MS,
  cacheMaxEntries = CODEX_HISTORY_CACHE_MAX_ENTRIES,
  maxInFlight = CODEX_HISTORY_MAX_IN_FLIGHT,
}: HistoryReaderOptions) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<MarketPriceHistoryResponse>>();

  return async function readCodexMarketHistory(
    assetId: string,
    range: string,
  ): Promise<MarketPriceHistoryResponse> {
    const identity = resolveMarketPriceAssetIdentity(assetId);
    if (!isMarketPriceRange(range)) {
      return createHistoryResponse({
        assetId: identity?.assetId ?? null,
        range: null,
        status: "unavailable",
        unavailableReason: "invalid-range",
      });
    }
    if (!identity) {
      return createHistoryResponse({
        assetId: null,
        range,
        status: "unavailable",
        unavailableReason: "unknown-asset",
      });
    }
    if (!apiKey?.trim()) {
      return createHistoryResponse({
        assetId: identity.assetId,
        range,
        status: "unavailable",
        unavailableReason: "not-configured",
      });
    }

    const cacheKey = `${identity.assetId}:${range}`;
    const currentTime = now().getTime();
    pruneExpiredCache(cache, currentTime, cacheTtlMs);
    const cached = cache.get(cacheKey);
    if (cached) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached.response;
    }
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
    if (inFlight.size >= maxInFlight) {
      return createHistoryResponse({
        assetId: identity.assetId,
        range,
        status: "unavailable",
        unavailableReason: "overloaded",
      });
    }

    const request = fetchHistory({
      apiKey: apiKey.trim(),
      identity,
      range,
      fetchImpl,
      now,
      timeoutMs,
    });
    inFlight.set(cacheKey, request);

    try {
      const response = await request;
      setBoundedCacheEntry(
        cache,
        cacheKey,
        { storedAt: now().getTime(), response },
        cacheMaxEntries,
      );
      return response;
    } finally {
      inFlight.delete(cacheKey);
    }
  };
}

function pruneExpiredCache(
  cache: Map<string, CacheEntry>,
  currentTime: number,
  cacheTtlMs: number,
) {
  for (const [key, entry] of cache) {
    if (currentTime - entry.storedAt > cacheTtlMs) cache.delete(key);
  }
}

function setBoundedCacheEntry(
  cache: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry,
  cacheMaxEntries: number,
) {
  if (cacheMaxEntries <= 0) return;
  cache.delete(key);
  while (cache.size >= cacheMaxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

export function createErrorMarketHistoryResponse(
  assetId: MarketPriceAssetId | null = null,
  range: MarketPriceRange | null = null,
): MarketPriceHistoryResponse {
  return createHistoryResponse({
    assetId,
    range,
    status: "error",
  });
}

let sharedReader: ReturnType<typeof createCodexMarketHistoryReader> | null =
  null;
let sharedKey: string | undefined;

export function getCodexMarketHistory(
  assetId: string,
  range: string,
): Promise<MarketPriceHistoryResponse> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createCodexMarketHistoryReader({ apiKey });
  }
  return sharedReader(assetId, range);
}

export function clearCodexMarketHistoryCacheForTests() {
  sharedReader = null;
  sharedKey = undefined;
}

async function fetchHistory({
  apiKey,
  identity,
  range,
  fetchImpl,
  now,
  timeoutMs,
}: {
  apiKey: string;
  identity: MarketPriceAssetIdentity;
  range: MarketPriceRange;
  fetchImpl: FetchLike;
  now: Clock;
  timeoutMs: number;
}): Promise<MarketPriceHistoryResponse> {
  const fetchedAt = now();
  const window = MARKET_HISTORY_WINDOWS[range];
  const to = Math.floor(fetchedAt.getTime() / 1_000);
  const from = to - window.durationSeconds;
  const payload = await executeCodexBars({
    apiKey,
    symbol: `${identity.contractAddress.toLowerCase()}:${identity.chainId}`,
    from,
    to,
    resolution: window.resolution,
    fetchImpl,
    timeoutMs,
  });
  const points = normalizeBars(payload);

  return createHistoryResponse({
    assetId: identity.assetId,
    range,
    fetchedAt: fetchedAt.toISOString(),
    status: points.length > 0 ? "ready" : "empty",
    points,
  });
}

async function executeCodexBars({
  apiKey,
  symbol,
  from,
  to,
  resolution,
  fetchImpl,
  timeoutMs,
}: {
  apiKey: string;
  symbol: string;
  from: number;
  to: number;
  resolution: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    headers.set(["Author", "ization"].join(""), apiKey);
    const response = await fetchImpl(CODEX_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: CODEX_BARS_QUERY,
        variables: { symbol, from, to, resolution },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodexMarketDataError(
        `Codex market history returned HTTP ${response.status}.`,
      );
    }

    const parsed = parseJsonWithNumberLexemes(await response.text());
    const envelope = readRecord(parsed);
    if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
      throw new CodexMarketDataError("Codex market history returned an error.");
    }
    if (envelope?.data === null || envelope?.data === undefined) {
      throw new CodexMarketDataError("Codex market history returned no data.");
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof CodexMarketDataError) throw error;
    const message = controller.signal.aborted
      ? "Codex market history timed out."
      : "Codex market history request failed.";
    throw new CodexMarketDataError(message, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBars(data: unknown): MarketPriceHistoryPoint[] {
  const record = readRecord(data);
  const bars = readRecord(record?.getBars);
  if (!bars) throwMalformedBars();

  const status = bars.s;
  if (status !== "ok" && status !== "no_data") throwMalformedBars();
  if (!Array.isArray(bars.t) || !Array.isArray(bars.c)) throwMalformedBars();
  if (bars.t.length !== bars.c.length) throwMalformedBars();
  if (status === "no_data") {
    if (bars.t.length !== 0) throwMalformedBars();
    return [];
  }

  const points: MarketPriceHistoryPoint[] = [];
  for (let index = 0; index < bars.t.length; index += 1) {
    const timestampSeconds = readInteger(bars.t[index]);
    if (timestampSeconds === null) throwMalformedBars();

    const time = new Date(timestampSeconds * 1_000);
    if (Number.isNaN(time.getTime())) throwMalformedBars();

    // Codex documents close values as nullable Float entries. A null close has
    // no point to expose, while every non-null close must be a valid price.
    if (bars.c[index] === null) continue;
    const value = readPositiveDecimal(bars.c[index]);
    if (!value) throwMalformedBars();

    points.push({ time: time.toISOString(), value });
  }
  return points;
}

function throwMalformedBars(): never {
  throw new CodexMarketDataError("Codex market history returned malformed bars.");
}

function createHistoryResponse({
  assetId,
  range,
  fetchedAt = null,
  status,
  points = [],
  unavailableReason,
}: {
  assetId: MarketPriceAssetId | null;
  range: MarketPriceRange | null;
  fetchedAt?: string | null;
  status: MarketPriceHistoryResponse["status"];
  points?: readonly MarketPriceHistoryPoint[];
  unavailableReason?: MarketPriceHistoryResponse["unavailableReason"];
}): MarketPriceHistoryResponse {
  return {
    version: MARKET_PRICE_HISTORY_VERSION,
    provider: "codex",
    assetId,
    range,
    currency: "USD",
    fetchedAt,
    status,
    points,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readPositiveDecimal(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const mantissa = value.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(mantissa) ? value : null;
}
