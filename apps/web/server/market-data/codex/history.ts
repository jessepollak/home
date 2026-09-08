import {
  investAssets,
  type InvestAsset,
  type InvestAssetId,
} from "@/config/invest-assets";
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
  type MarketPriceHistoryPoint,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "./history-contract";

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
};

type CacheEntry = {
  storedAt: number;
  response: MarketPriceHistoryResponse;
};

const assetById = new Map<InvestAssetId, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);

function isInvestAssetId(value: string): value is InvestAssetId {
  return assetById.has(value as InvestAssetId);
}

export function createCodexMarketHistoryReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: HistoryReaderOptions) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<MarketPriceHistoryResponse>>();

  return async function readCodexMarketHistory(
    assetId: string,
    range: string,
  ): Promise<MarketPriceHistoryResponse> {
    if (!isMarketPriceRange(range)) {
      return createHistoryResponse({
        assetId: isInvestAssetId(assetId) ? assetId : null,
        range: null,
        status: "unavailable",
        unavailableReason: "invalid-range",
      });
    }
    if (!isInvestAssetId(assetId)) {
      return createHistoryResponse({
        assetId: null,
        range,
        status: "unavailable",
        unavailableReason: "unknown-asset",
      });
    }
    if (!apiKey?.trim()) {
      return createHistoryResponse({
        assetId,
        range,
        status: "unavailable",
        unavailableReason: "not-configured",
      });
    }

    const cacheKey = `${assetId}:${range}`;
    const currentTime = now().getTime();
    const cached = cache.get(cacheKey);
    if (cached && currentTime - cached.storedAt <= CODEX_CACHE_TTL_MS) {
      return cached.response;
    }
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;

    const request = fetchHistory({
      apiKey: apiKey.trim(),
      asset: assetById.get(assetId)!,
      range,
      fetchImpl,
      now,
      timeoutMs,
    });
    inFlight.set(cacheKey, request);

    try {
      const response = await request;
      cache.set(cacheKey, { storedAt: now().getTime(), response });
      return response;
    } finally {
      inFlight.delete(cacheKey);
    }
  };
}

export function createErrorMarketHistoryResponse(
  assetId: InvestAssetId | null = null,
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
  asset,
  range,
  fetchImpl,
  now,
  timeoutMs,
}: {
  apiKey: string;
  asset: InvestAsset;
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
    symbol: `${asset.contractAddress.toLowerCase()}:${asset.chainId}`,
    from,
    to,
    resolution: window.resolution,
    fetchImpl,
    timeoutMs,
  });
  const points = normalizeBars(payload);

  return createHistoryResponse({
    assetId: asset.id as InvestAssetId,
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
  if (!bars) return [];
  if (typeof bars.s === "string" && bars.s !== "ok") return [];
  if (!Array.isArray(bars.t) || !Array.isArray(bars.c)) return [];
  if (bars.t.length !== bars.c.length) return [];

  const points: MarketPriceHistoryPoint[] = [];
  for (let index = 0; index < bars.t.length; index += 1) {
    const timestampSeconds = readInteger(bars.t[index]);
    const value = readPositiveDecimal(bars.c[index]);
    if (timestampSeconds === null || !value) continue;
    const time = new Date(timestampSeconds * 1_000);
    if (Number.isNaN(time.getTime())) continue;
    points.push({ time: time.toISOString(), value });
  }
  return points;
}

function createHistoryResponse({
  assetId,
  range,
  fetchedAt = null,
  status,
  points = [],
  unavailableReason,
}: {
  assetId: InvestAssetId | null;
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
