import type { ExactDecimal } from "@/shared/balances/types";
import {
  resolveMarketPriceAssetIdentity,
  type MarketPriceAssetId,
} from "./market-price-history";

export const MARKET_STATS_VERSION = 1 as const;

export type MarketStats = {
  marketCapUsd?: ExactDecimal;
  volume24hUsd?: ExactDecimal;
  liquidityUsd?: ExactDecimal;
};

export type MarketStatsResponse = {
  version: typeof MARKET_STATS_VERSION;
  provider: "codex";
  assetId: MarketPriceAssetId | null;
  currency: "USD";
  fetchedAt: string | null;
  status: "ready" | "unavailable" | "error";
  stats: MarketStats;
  unavailableReason?: "not-configured" | "unknown-asset" | "unsupported-asset";
};

const STAT_KEYS = ["marketCapUsd", "volume24hUsd", "liquidityUsd"] as const;
const UNAVAILABLE_REASONS = new Set(["not-configured", "unknown-asset", "unsupported-asset"]);

export function parseMarketStatsResponse(value: unknown): MarketStatsResponse | null {
  const record = readRecord(value);
  if (
    !record ||
    record.version !== MARKET_STATS_VERSION ||
    record.provider !== "codex" ||
    record.currency !== "USD" ||
    !(record.status === "ready" || record.status === "unavailable" || record.status === "error") ||
    !(record.fetchedAt === null || isIsoDate(record.fetchedAt))
  ) {
    return null;
  }
  const assetId = record.assetId === null
    ? null
    : typeof record.assetId === "string"
      ? resolveMarketPriceAssetIdentity(record.assetId)?.assetId
      : undefined;
  if (assetId === undefined) return null;
  const statsRecord = readRecord(record.stats);
  if (!statsRecord) return null;
  const stats: MarketStats = {};
  for (const key of STAT_KEYS) {
    const raw = statsRecord[key];
    if (raw === undefined) continue;
    const decimal = readExactDecimal(raw);
    if (!decimal) return null;
    stats[key] = decimal;
  }
  if (record.status !== "ready" && Object.keys(stats).length > 0) return null;
  if (
    record.unavailableReason !== undefined &&
    (record.status !== "unavailable" || !UNAVAILABLE_REASONS.has(record.unavailableReason as string))
  ) {
    return null;
  }
  return {
    version: MARKET_STATS_VERSION,
    provider: "codex",
    assetId,
    currency: "USD",
    fetchedAt: record.fetchedAt as string | null,
    status: record.status,
    stats,
    ...(record.unavailableReason !== undefined
      ? { unavailableReason: record.unavailableReason as NonNullable<MarketStatsResponse["unavailableReason"]> }
      : {}),
  };
}

function readExactDecimal(value: unknown): ExactDecimal | null {
  const record = readRecord(value);
  if (
    !record ||
    typeof record.atoms !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(record.atoms) ||
    typeof record.scale !== "number" ||
    !Number.isSafeInteger(record.scale) ||
    record.scale < 0 ||
    record.scale > 36
  ) {
    return null;
  }
  return { atoms: record.atoms, scale: record.scale };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
