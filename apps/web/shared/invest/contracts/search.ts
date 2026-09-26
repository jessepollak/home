import { investAssets, type InvestAsset } from "@/config/invest-assets";
import type { MarketSnapshot } from "@/shared/invest/invest-market";
import { parseDynamicInvestAsset } from "./discover";

export const INVEST_SEARCH_VERSION = 1 as const;
export const INVEST_SEARCH_QUERY_MAX_LENGTH = 64;
export const INVEST_SEARCH_PAGE_SIZE = 20;
export const INVEST_SEARCH_MAX_OFFSET = 100;

export type InvestSearchMatch = "contract" | "exact" | "prefix" | "partial";
export type InvestSearchSource = "configured" | "indexed" | "onchain";

export function investSearchRank(match: InvestSearchMatch, source: InvestSearchSource): number {
  if (match === "contract") return 0;
  return ({ exact: 1, prefix: 3, partial: 5 } as const)[match] + (source === "configured" ? 0 : 1);
}

export function rankInvestSearchResults<T extends { match: InvestSearchMatch; source: InvestSearchSource }>(results: readonly T[]): T[] {
  return results.map((result, index) => ({ result, index }))
    .sort((a, b) => investSearchRank(a.result.match, a.result.source) - investSearchRank(b.result.match, b.result.source) || a.index - b.index)
    .map(({ result }) => result);
}

export type InvestSearchProviderStatus =
  | "ok"
  | "skipped"
  | "unavailable"
  | "error";

export type InvestSearchWireResult =
  | { kind: "configured"; assetId: string; match: InvestSearchMatch }
  | {
      kind: "dynamic";
      asset: InvestAsset;
      match: InvestSearchMatch;
      source: Exclude<InvestSearchSource, "configured">;
    };

export type InvestSearchResponse = {
  version: typeof INVEST_SEARCH_VERSION;
  query: string;
  offset: number;
  results: readonly InvestSearchWireResult[];
  snapshots: readonly MarketSnapshot[];
  provider: InvestSearchProviderStatus;
  coverage: "complete" | "partial";
  nextOffset: number | null;
};

export type InvestSearchResult = {
  asset: InvestAsset;
  match: InvestSearchMatch;
  source: InvestSearchSource;
};

export type InvestSearchPage = {
  query: string;
  offset: number;
  results: readonly InvestSearchResult[];
  snapshots: readonly MarketSnapshot[];
  provider: InvestSearchProviderStatus;
  coverage: "complete" | "partial";
  nextOffset: number | null;
};

export type InvestSearchRequest = { query: string; offset: number };

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const configuredById = new Map<string, InvestAsset>(
  investAssets.map((asset) => [asset.id, asset]),
);

export function normalizeInvestSearchQuery(raw: string): string | null {
  const normalized = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length <= INVEST_SEARCH_QUERY_MAX_LENGTH ? normalized : null;
}

export function isInvestSearchAddressQuery(query: string): boolean {
  return addressPattern.test(query);
}

export function parseInvestSearchRequest(
  params: URLSearchParams,
): InvestSearchRequest | null {
  const rawQuery = params.get("q");
  if (rawQuery === null || rawQuery.length > INVEST_SEARCH_QUERY_MAX_LENGTH * 4) {
    return null;
  }
  const query = normalizeInvestSearchQuery(rawQuery);
  if (query === null || query.length === 0) return null;
  const rawOffset = params.get("offset");
  const offset = rawOffset === null || rawOffset === "" ? 0 : Number(rawOffset);
  if (
    rawOffset !== null &&
    rawOffset !== "" &&
    !/^(?:0|[1-9]\d*)$/.test(rawOffset)
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > INVEST_SEARCH_MAX_OFFSET ||
    offset % INVEST_SEARCH_PAGE_SIZE !== 0
  ) {
    return null;
  }
  return { query, offset };
}

export function investSearchSearchParams({
  query,
  offset,
}: InvestSearchRequest): URLSearchParams {
  const params = new URLSearchParams({ q: query });
  if (offset > 0) params.set("offset", String(offset));
  return params;
}

export function parseInvestSearchResponse(
  value: unknown,
): InvestSearchPage | null {
  const record = readRecord(value);
  if (
    !record ||
    record.version !== INVEST_SEARCH_VERSION ||
    typeof record.query !== "string" ||
    typeof record.offset !== "number" ||
    !Number.isSafeInteger(record.offset) ||
    record.offset < 0 ||
    !Array.isArray(record.results) ||
    !Array.isArray(record.snapshots) ||
    !isProviderStatus(record.provider) ||
    (record.coverage !== "complete" && record.coverage !== "partial")
  ) {
    return null;
  }
  const nextOffset = record.nextOffset;
  if (
    nextOffset !== null &&
    (typeof nextOffset !== "number" ||
      !Number.isSafeInteger(nextOffset) ||
      nextOffset <= record.offset ||
      nextOffset > INVEST_SEARCH_MAX_OFFSET)
  ) {
    return null;
  }

  const results: InvestSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of record.results) {
    const result = parseResult(item);
    if (!result) return null;
    const key = result.asset.contractAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
  }

  const dynamicIds = new Set(
    results.filter((result) => result.source !== "configured").map((result) => result.asset.id),
  );
  const snapshots: MarketSnapshot[] = [];
  for (const item of record.snapshots) {
    const snapshot = parseSnapshot(item);
    if (!snapshot) return null;
    if (dynamicIds.has(snapshot.assetId)) snapshots.push(snapshot);
  }

  return {
    query: record.query,
    offset: record.offset,
    results,
    snapshots,
    provider: record.provider,
    coverage: record.coverage,
    nextOffset,
  };
}

function parseResult(value: unknown): InvestSearchResult | null {
  const record = readRecord(value);
  if (!record || !isMatch(record.match)) return null;
  if (record.kind === "configured") {
    const asset =
      typeof record.assetId === "string" ? configuredById.get(record.assetId) : undefined;
    return asset ? { asset, match: record.match, source: "configured" } : null;
  }
  if (
    record.kind !== "dynamic" ||
    (record.source !== "indexed" && record.source !== "onchain")
  ) {
    return null;
  }
  const asset = parseDynamicInvestAsset(record.asset);
  return asset ? { asset, match: record.match, source: record.source } : null;
}

function parseSnapshot(value: unknown): MarketSnapshot | null {
  const snapshot = readRecord(value);
  if (
    !snapshot ||
    typeof snapshot.assetId !== "string" ||
    typeof snapshot.displayPrice !== "string" ||
    snapshot.displayPrice.length === 0 ||
    typeof snapshot.asOf !== "string" ||
    typeof snapshot.sourceLabel !== "string"
  ) {
    return null;
  }
  return {
    assetId: snapshot.assetId,
    displayPrice: snapshot.displayPrice,
    asOf: snapshot.asOf,
    sourceLabel: snapshot.sourceLabel,
    ...(typeof snapshot.sourceUrl === "string" ? { sourceUrl: snapshot.sourceUrl } : {}),
    ...(typeof snapshot.changeLabel === "string"
      ? { changeLabel: snapshot.changeLabel }
      : {}),
  };
}

function isMatch(value: unknown): value is InvestSearchMatch {
  return value === "contract" || value === "exact" || value === "prefix" || value === "partial";
}

function isProviderStatus(value: unknown): value is InvestSearchProviderStatus {
  return value === "ok" || value === "skipped" || value === "unavailable" || value === "error";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
