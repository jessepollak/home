import "server-only";

import { readCodexApiKey } from "@/server/config/env";

import { createBoundedCache } from "@/server/cache/bounded";

import { investAssets } from "@/config/invest-assets";
import { parseExactDecimal } from "@/shared/balances/math";
import {
  MARKET_STATS_VERSION,
  type MarketStats,
  type MarketStatsResponse,
} from "@/shared/invest/contracts/market-stats";
import {
  resolveMarketPriceAssetIdentity,
  type MarketPriceAssetIdentity,
} from "@/shared/invest/contracts/market-price-history";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";
import {
  executeCodexGraphql,
  readAddress,
  readInteger,
  readPositiveDecimal,
  readRecord,
  type FetchLike,
} from "./execute";

const CODEX_STATS_TTL_MS = 60_000;
const CODEX_STATS_CACHE_MAX = 64;
const CODEX_STATS_MAX_IN_FLIGHT = 8;

const CODEX_MARKET_STATS_QUERY = `query BaseMarketStats($tokens: [String!], $limit: Int) {
  filterTokens(tokens: $tokens, limit: $limit) {
    results {
      marketCap
      volume24
      liquidity
      token {
        address
        networkId
      }
    }
  }
}`;

type StatsOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  maxInFlight?: number;
};

const stockIds = new Set<string>(investAssets.filter((asset) => asset.category === "stock").map((asset) => asset.id));

export function createErrorMarketStatsResponse(
  assetId: MarketStatsResponse["assetId"],
): MarketStatsResponse {
  return createResponse(assetId, "error");
}

export function createCodexMarketStatsReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
  cacheTtlMs = CODEX_STATS_TTL_MS,
  cacheMaxEntries = CODEX_STATS_CACHE_MAX,
  maxInFlight = CODEX_STATS_MAX_IN_FLIGHT,
}: StatsOptions) {
  const cache = createBoundedCache<MarketStatsResponse>({
    maxEntries: cacheMaxEntries,
    ttlMs: cacheTtlMs,
    maxInFlight,
    now: () => now().getTime(),
    retain: (value) => value.status === "ready",
  });

  return async function readCodexMarketStats(assetId: string): Promise<MarketStatsResponse> {
    const identity = resolveMarketPriceAssetIdentity(assetId);
    if (!identity) return createResponse(null, "unavailable", "unknown-asset");
    if (stockIds.has(identity.assetId)) {
      return createResponse(identity.assetId, "unavailable", "unsupported-asset");
    }
    if (!apiKey?.trim()) {
      return createResponse(identity.assetId, "unavailable", "not-configured");
    }

    const result = await cache.fetch(
      identity.assetId,
      () => fetchStats(identity, apiKey.trim(), fetchImpl, now, timeoutMs)
        .catch(() => createErrorMarketStatsResponse(identity.assetId)),
    );
    return result.status === "saturated"
      ? createErrorMarketStatsResponse(identity.assetId)
      : result.value;
  };
}

let sharedReader: ReturnType<typeof createCodexMarketStatsReader> | null = null;
let sharedKey: string | undefined;

export function getCodexMarketStats(assetId: string): Promise<MarketStatsResponse> {
  const apiKey = readCodexApiKey();
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createCodexMarketStatsReader({ apiKey });
  }
  return sharedReader(assetId);
}

async function fetchStats(
  identity: MarketPriceAssetIdentity,
  apiKey: string,
  fetchImpl: FetchLike,
  now: () => Date,
  timeoutMs: number,
): Promise<MarketStatsResponse> {
  const payload = await executeCodexGraphql({
    apiKey,
    query: CODEX_MARKET_STATS_QUERY,
    variables: {
      tokens: [`${identity.contractAddress.toLowerCase()}:${identity.chainId}`],
      limit: 1,
    },
    fetchImpl,
    timeoutMs,
  });
  const results = readRecord(readRecord(payload)?.filterTokens)?.results;
  if (!Array.isArray(results)) throw new Error("Invalid Codex market stats results");
  const row = results.length === 1 ? readRecord(results[0]) : null;
  const token = readRecord(row?.token);
  const address = readAddress(token?.address);
  const stats: MarketStats = {};
  if (
    address?.toLowerCase() === identity.contractAddress.toLowerCase() &&
    readInteger(token?.networkId) === identity.chainId
  ) {
    const marketCapUsd = readStat(row?.marketCap);
    const volume24hUsd = readStat(row?.volume24);
    const liquidityUsd = readStat(row?.liquidity);
    if (marketCapUsd) stats.marketCapUsd = marketCapUsd;
    if (volume24hUsd) stats.volume24hUsd = volume24hUsd;
    if (liquidityUsd) stats.liquidityUsd = liquidityUsd;
  }
  return {
    ...createResponse(identity.assetId, "ready"),
    fetchedAt: now().toISOString(),
    stats,
  };
}

function readStat(value: unknown): NonNullable<MarketStats["marketCapUsd"]> | null {
  const raw = readPositiveDecimal(value);
  if (!raw) return null;
  const decimal = parseExactDecimal(raw);
  return decimal && decimal.scale <= 36 ? decimal : null;
}

function createResponse(
  assetId: MarketStatsResponse["assetId"],
  status: MarketStatsResponse["status"],
  unavailableReason?: MarketStatsResponse["unavailableReason"],
): MarketStatsResponse {
  return {
    version: MARKET_STATS_VERSION,
    provider: "codex",
    assetId,
    currency: "USD",
    fetchedAt: null,
    status,
    stats: {},
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}
