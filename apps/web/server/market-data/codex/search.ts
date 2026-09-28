import "server-only";

import { investAssets, isDiscoverableAsset, type InvestAsset } from "@/config/invest-assets";
import { normalizeInvestSearchQuery, isInvestSearchAddressQuery, investSearchRank, rankInvestSearchResults, INVEST_SEARCH_MAX_OFFSET, INVEST_SEARCH_PAGE_SIZE, INVEST_SEARCH_VERSION, type InvestSearchMatch, type InvestSearchRequest, type InvestSearchResponse, type InvestSearchWireResult } from "@/shared/invest/contracts/search";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";
import { executeCodexGraphql, readRecord } from "./execute";
import { assetReadsToken0, createAssetResolver, resolveAsset, type AssetResolverOptions } from "../resolve-asset";
import { normalizeTrendingMemes } from "./trending";
import { createPairCheck } from "./pair-check";

export const CODEX_SEARCH_TTL_MS = 45_000;
export const CODEX_SEARCH_CACHE_MAX = 256;
export const CODEX_SEARCH_MAX_IN_FLIGHT = 8;
export const CODEX_SEARCH_PAIR_CACHE_MAX = 512;
export const CODEX_SEARCH_PAIR_CACHE_TTL_MS = 300_000;
export const CODEX_SEARCH_MAX_PAIR_CHECKS = 8;
export const CODEX_SEARCH_QUERY = `query SearchBaseTokens($phrase: String, $filters: TokenFilters, $rankings: [TokenRanking!], $limit: Int, $offset: Int) {
  filterTokens(phrase: $phrase, filters: $filters, rankings: $rankings, limit: $limit, offset: $offset) {
    results { priceUSD change24 lastTransaction token { address name symbol decimals networkId info { imageThumbUrl imageSmallUrl imageLargeUrl } } }
    count page
  }
}`;

type SearchOptions = AssetResolverOptions & { resolve?: typeof resolveAsset };
type Cached = { storedAt: number; value: InvestSearchResponse };

function matchAliases(query: string, aliases: readonly string[]): InvestSearchMatch | null {
  const needle = query.toLowerCase();
  if (aliases.some((alias) => alias.toLowerCase() === needle)) return "exact";
  if (aliases.some((alias) => alias.toLowerCase().startsWith(needle) || alias.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle)))) return "prefix";
  return needle.length >= 2 && aliases.some((alias) => alias.toLowerCase().includes(needle)) ? "partial" : null;
}

function configuredMatches(query: string, assets: readonly InvestAsset[]): InvestSearchWireResult[] {
  const address = isInvestSearchAddressQuery(query);
  return assets.filter((asset) => isDiscoverableAsset(asset)).flatMap((asset) => {
    const match = address && asset.contractAddress.toLowerCase() === query.toLowerCase()
      ? "contract" as const
      : address ? null : matchAliases(query, [asset.id, asset.displayName, asset.displaySymbol, asset.representation.tokenSymbol, asset.contractAddress]);
    return match ? [{ kind: "configured" as const, assetId: asset.id, match }] : [];
  }).sort((a, b) => investSearchRank(a.match, "configured") - investSearchRank(b.match, "configured")).slice(0, 8);
}

function readPageInteger(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value))) return null;
  const integer = Number(value);
  return Number.isSafeInteger(integer) && integer >= 0 && !Object.is(integer, -0) ? integer : null;
}

function response(query: string, offset: number, results: InvestSearchWireResult[], snapshots: InvestSearchResponse["snapshots"], provider: InvestSearchResponse["provider"], nextOffset: number | null): InvestSearchResponse {
  return { version: INVEST_SEARCH_VERSION, query, offset, results, snapshots, provider, coverage: provider === "error" || provider === "unavailable" ? "partial" : "complete", nextOffset };
}

export function createCodexSearchReader({ apiKey, fetchImpl = fetch, onchain, isPair, resolve, now = () => new Date(), timeoutMs = CODEX_REQUEST_TIMEOUT_MS, cacheMaxEntries = CODEX_SEARCH_CACHE_MAX, maxInFlight = CODEX_SEARCH_MAX_IN_FLIGHT, assets = investAssets }: SearchOptions & { assets?: readonly InvestAsset[] }) {
  const configuredContracts = new Set(assets.map((asset) => asset.contractAddress.toLowerCase()));
  const readAsset = resolve ?? createAssetResolver({ apiKey, fetchImpl, onchain, isPair, now, timeoutMs, cacheMaxEntries, maxInFlight });
  const checkPair = createPairCheck({ read: isPair ?? assetReadsToken0, maxConcurrent: CODEX_SEARCH_MAX_PAIR_CHECKS, cacheMaxEntries: CODEX_SEARCH_PAIR_CACHE_MAX, ttlMs: CODEX_SEARCH_PAIR_CACHE_TTL_MS });
  const cache = new Map<string, Cached>();
  const inFlight = new Map<string, Promise<InvestSearchResponse>>();
  return async function search({ query: raw, offset }: InvestSearchRequest): Promise<InvestSearchResponse> {
    const normalized = normalizeInvestSearchQuery(raw);
    if (!normalized || !Number.isSafeInteger(offset) || offset < 0 || offset > INVEST_SEARCH_MAX_OFFSET || offset % INVEST_SEARCH_PAGE_SIZE !== 0) throw new Error("Invalid search request");
    if (isInvestSearchAddressQuery(normalized)) {
      if (offset !== 0) return response(normalized, offset, [], [], "skipped", null);
      const resolved = await readAsset(normalized);
      const results: InvestSearchWireResult[] = resolved.asset && resolved.source && (resolved.source !== "configured" || isDiscoverableAsset(resolved.asset))
        ? [resolved.source === "configured"
          ? { kind: "configured", assetId: resolved.asset.id, match: "contract" }
          : { kind: "dynamic", asset: resolved.asset, source: resolved.source, match: "contract" }]
        : [];
      return response(normalized, offset, results, resolved.snapshot ? [resolved.snapshot] : [], resolved.provider, null);
    }
    const query = normalized.toLowerCase();
    const configured = offset === 0 ? configuredMatches(normalized, assets) : [];
    const key = `${query}:${offset}`;
    const timestamp = now().getTime();
    for (const [candidate, entry] of cache) if (timestamp - entry.storedAt > CODEX_SEARCH_TTL_MS) cache.delete(candidate);
    const hit = cache.get(key);
    const forRequest = (value: InvestSearchResponse): InvestSearchResponse =>
      value.query === normalized ? value : { ...value, query: normalized };
    if (hit) { cache.delete(key); cache.set(key, hit); return forRequest(hit.value); }
    const pending = inFlight.get(key);
    if (pending) return pending.then(forRequest);
    if (/^0x[0-9a-f]*$/i.test(normalized) && !isInvestSearchAddressQuery(normalized)) return response(normalized, offset, configured, [], "skipped", null);
    if (!apiKey?.trim()) return response(normalized, offset, configured, [], "unavailable", null);
    if (inFlight.size >= maxInFlight) return response(normalized, offset, configured, [], "unavailable", null);

    const request = (async () => {
      try {
        const payload = await executeCodexGraphql({ apiKey: apiKey.trim(), fetchImpl, timeoutMs, query: CODEX_SEARCH_QUERY, variables: { phrase: normalized, filters: { network: [8453] }, rankings: [{ attribute: "trendingScore24", direction: "DESC" }], limit: INVEST_SEARCH_PAGE_SIZE, offset } });
        const connection = readRecord(readRecord(payload)?.filterTokens);
        if (!connection || !Array.isArray(connection.results) || connection.results.length > INVEST_SEARCH_PAGE_SIZE || readPageInteger(connection.count) !== connection.results.length || readPageInteger(connection.page) !== offset) throw new Error("Invalid search page");
        const seen = new Set<string>();
        const rows: { result: Extract<InvestSearchWireResult, { kind: "dynamic" }>; snapshot?: InvestSearchResponse["snapshots"][number] }[] = [];
        for (const row of connection.results) {
          const normalizedRow = normalizeTrendingMemes({ filterTokens: { results: [row] } }, now());
          const asset = normalizedRow.assets[0];
          if (!asset || configuredContracts.has(asset.contractAddress.toLowerCase()) || seen.has(asset.contractAddress.toLowerCase())) continue;
          seen.add(asset.contractAddress.toLowerCase());
          const match = matchAliases(normalized, [asset.displayName, asset.displaySymbol, asset.contractAddress]);
          if (!match) continue;
          const result: Extract<InvestSearchWireResult, { kind: "dynamic" }> = { kind: "dynamic", asset: { ...asset, descriptor: "Base token" }, source: "indexed", match };
          rows.push({ result, snapshot: normalizedRow.snapshots[0] });
        }
        const checks = await Promise.all(rows.map(async ({ result }) => {
          try { return await checkPair(result.asset.contractAddress); } catch { return null; }
        }));
        const kept = rows.filter((_, index) => checks[index] === false);
        const ranked = rankInvestSearchResults([...configured, ...kept.map(({ result }) => result)].map((result) => ({
          result,
          match: result.match,
          source: result.kind === "configured" ? "configured" : result.source,
        }))).map(({ result }) => result);
        const nextOffset = connection.results.length === INVEST_SEARCH_PAGE_SIZE && offset < INVEST_SEARCH_MAX_OFFSET ? offset + INVEST_SEARCH_PAGE_SIZE : null;
        return response(normalized, offset, ranked, kept.flatMap(({ snapshot }) => snapshot ? [snapshot] : []), checks.includes(null) ? "error" : "ok", nextOffset);
      } catch {
        return response(normalized, offset, configured, [], "error", null);
      }
    })();
    inFlight.set(key, request);
    try {
      const result = await request;
      if (result.provider === "ok") {
        cache.delete(key);
        cache.set(key, { storedAt: now().getTime(), value: result });
        while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value!);
      }
      return forRequest(result);
    } finally { inFlight.delete(key); }
  };
}

let sharedReader: ReturnType<typeof createCodexSearchReader> | null = null;
let sharedKey: string | undefined;
export function getCodexSearch(request: InvestSearchRequest): Promise<InvestSearchResponse> {
  const key = process.env.CODEX_API_KEY;
  if (!sharedReader || key !== sharedKey) { sharedKey = key; sharedReader = createCodexSearchReader({ apiKey: key, resolve: resolveAsset }); }
  return sharedReader(request);
}
