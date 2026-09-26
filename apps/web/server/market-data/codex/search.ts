import "server-only";

import { investAssets, initialsFromSymbol, trendingTokenId, type InvestAsset } from "@/config/invest-assets";
import { normalizeInvestSearchQuery, isInvestSearchAddressQuery, investSearchRank, rankInvestSearchResults, INVEST_SEARCH_MAX_OFFSET, INVEST_SEARCH_PAGE_SIZE, INVEST_SEARCH_VERSION, type InvestSearchMatch, type InvestSearchRequest, type InvestSearchResponse, type InvestSearchWireResult } from "@/shared/invest/contracts/search";
import { baseRpc, BaseRpcError } from "@/server/chain/rpc";
import { createActivityTokenRpcResolver } from "@/server/activity/token-metadata-rpc";
import { encodeFunctionData, decodeFunctionResult } from "viem";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";
import { executeCodexGraphql, readAddress, readInteger, readRecord, type FetchLike } from "./execute";
import { normalizeTrendingMemes } from "./trending";

export const CODEX_SEARCH_TTL_MS = 45_000;
export const CODEX_SEARCH_CACHE_MAX = 256;
export const CODEX_SEARCH_MAX_IN_FLIGHT = 8;
export const CODEX_SEARCH_QUERY = `query SearchBaseTokens($phrase: String, $filters: TokenFilters, $rankings: [TokenRanking!], $limit: Int, $offset: Int) {
  filterTokens(phrase: $phrase, filters: $filters, rankings: $rankings, limit: $limit, offset: $offset) {
    results { priceUSD change24 lastTransaction token { address name symbol decimals networkId info { imageThumbUrl imageSmallUrl imageLargeUrl } } }
    count page
  }
}`;

export const CODEX_SEARCH_EXACT_QUERY = `query SearchBaseTokenByAddress($tokens: [String!], $limit: Int) {
  filterTokens(tokens: $tokens, limit: $limit) {
    results { priceUSD change24 lastTransaction token { address name symbol decimals networkId info { imageThumbUrl imageSmallUrl imageLargeUrl } } }
  }
}`;

const token0Abi = [{ type: "function", name: "token0", inputs: [], outputs: [{ name: "", type: "address" }], stateMutability: "view" }] as const;
const configuredContracts = new Set(investAssets.map((asset) => asset.contractAddress.toLowerCase()));
const resolveRpcMetadata = createActivityTokenRpcResolver();

type Onchain = (address: `0x${string}`) => Promise<{ symbol: string; decimals: number } | null>;
type SearchOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  onchain?: Onchain;
  isPair?: (address: `0x${string}`) => Promise<boolean | null>;
  now?: () => Date;
  timeoutMs?: number;
  cacheMaxEntries?: number;
  maxInFlight?: number;
};

type Cached = { storedAt: number; value: InvestSearchResponse };

function isCallRevert(error: unknown): boolean {
  return error instanceof BaseRpcError && error.code === "rpc" &&
    (error.rpcCode === 3 || /execution reverted/i.test(error.message));
}

export async function readsToken0(address: `0x${string}`, rpc: typeof baseRpc = baseRpc): Promise<boolean | null> {
  let response: unknown;
  try {
    response = await rpc("eth_call", [{ to: address, data: encodeFunctionData({ abi: token0Abi, functionName: "token0" }) }, "latest"], { timeoutMs: 3_000 });
  } catch (error) {
    return isCallRevert(error) ? false : null;
  }
  if (typeof response !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(response)) return null;
  try {
    decodeFunctionResult({ abi: token0Abi, functionName: "token0", data: response as `0x${string}` });
    return true;
  } catch {
    return false;
  }
}

export async function readOnchainSearchIdentity(address: `0x${string}`): Promise<{ symbol: string; decimals: number } | null> {
  const value = (await resolveRpcMetadata([address])).get(address.toLowerCase());
  return value?.kind === "metadata" && value.symbol.trim() && value.symbol.length <= 64
    ? { symbol: value.symbol.trim(), decimals: value.decimals }
    : null;
}

function dynamicAsset(address: `0x${string}`, symbol: string, name: string, decimals: number, imageUrl?: string): InvestAsset {
  return {
    id: trendingTokenId(address), category: "meme", displayName: name, displaySymbol: symbol,
    initials: initialsFromSymbol(symbol), chainId: 8453, contractAddress: address,
    availability: "informational", descriptor: "Base token",
    representation: { tokenSymbol: symbol, decimals, relationship: "Base ERC-20 token; the display and token symbols are the same." },
    contractUrl: `https://basescan.org/token/${address}`,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function matchAliases(query: string, aliases: readonly string[]): InvestSearchMatch | null {
  const needle = query.toLowerCase();
  if (aliases.some((alias) => alias.toLowerCase() === needle)) return "exact";
  if (aliases.some((alias) => alias.toLowerCase().startsWith(needle) || alias.toLowerCase().split(/\s+/).some((word) => word.startsWith(needle)))) return "prefix";
  return needle.length >= 2 && aliases.some((alias) => alias.toLowerCase().includes(needle)) ? "partial" : null;
}

function configuredMatches(query: string): InvestSearchWireResult[] {
  const address = isInvestSearchAddressQuery(query);
  return investAssets.flatMap((asset) => {
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

export function createCodexSearchReader({ apiKey, fetchImpl = fetch, onchain = readOnchainSearchIdentity, isPair = readsToken0, now = () => new Date(), timeoutMs = CODEX_REQUEST_TIMEOUT_MS, cacheMaxEntries = CODEX_SEARCH_CACHE_MAX, maxInFlight = CODEX_SEARCH_MAX_IN_FLIGHT }: SearchOptions) {
  const cache = new Map<string, Cached>();
  const inFlight = new Map<string, Promise<InvestSearchResponse>>();
  return async function search({ query: raw, offset }: InvestSearchRequest): Promise<InvestSearchResponse> {
    const normalized = normalizeInvestSearchQuery(raw);
    if (!normalized || !Number.isSafeInteger(offset) || offset < 0 || offset > INVEST_SEARCH_MAX_OFFSET || offset % INVEST_SEARCH_PAGE_SIZE !== 0) throw new Error("Invalid search request");
    const query = normalized.toLowerCase();
    const configured = offset === 0 ? configuredMatches(normalized) : [];
    const key = `${query}:${offset}`;
    const timestamp = now().getTime();
    for (const [candidate, entry] of cache) if (timestamp - entry.storedAt > CODEX_SEARCH_TTL_MS) cache.delete(candidate);
    const hit = cache.get(key);
    const forRequest = (value: InvestSearchResponse): InvestSearchResponse =>
      value.query === normalized ? value : { ...value, query: normalized };
    if (hit) { cache.delete(key); cache.set(key, hit); return forRequest(hit.value); }
    const pending = inFlight.get(key);
    if (pending) return pending.then(forRequest);
    if (isInvestSearchAddressQuery(normalized) && configured.length > 0) return response(normalized, offset, configured, [], "skipped", null);
    if (/^0x[0-9a-f]*$/i.test(normalized) && !isInvestSearchAddressQuery(normalized)) return response(normalized, offset, configured, [], "skipped", null);
    if (!apiKey?.trim()) return response(normalized, offset, configured, [], "unavailable", null);
    if (inFlight.size >= maxInFlight) return response(normalized, offset, configured, [], "unavailable", null);

    const readExact = async (address: `0x${string}`): Promise<{ asset: InvestAsset; snapshots: InvestSearchResponse["snapshots"] } | null> => {
      const payload = await executeCodexGraphql({ apiKey: apiKey.trim(), fetchImpl, timeoutMs, query: CODEX_SEARCH_EXACT_QUERY, variables: { tokens: [`${address}:8453`], limit: 1 } });
      const connection = readRecord(readRecord(payload)?.filterTokens);
      if (!connection || !Array.isArray(connection.results) || connection.results.length > 1) throw new Error("Invalid exact search response");
      if (connection.results.length === 0) return null;
      const row = readRecord(connection.results[0]);
      const token = readRecord(row?.token);
      const returnedAddress = readAddress(token?.address);
      const networkId = readInteger(token?.networkId);
      if (!returnedAddress || networkId === null) throw new Error("Invalid exact search token");
      if (returnedAddress.toLowerCase() !== address || networkId !== 8453) return null;
      const normalized = normalizeTrendingMemes(payload, now());
      const asset = normalized.assets.find((candidate) => candidate.contractAddress.toLowerCase() === address);
      if (!asset) return null;
      return { asset, snapshots: normalized.snapshots.filter((snapshot) => snapshot.assetId === asset.id) };
    };

    const request = (async () => {
      try {
        if (isInvestSearchAddressQuery(normalized)) {
          if (offset !== 0) return response(normalized, offset, [], [], "skipped", null);
          const address = normalized.toLowerCase() as `0x${string}`;
          const indexed = await readExact(address);
          const pair = await isPair(address);
          if (pair === null) return response(normalized, offset, [], [], "error", null);
          if (pair) return response(normalized, offset, [], [], "ok", null);
          if (indexed) return response(normalized, offset, [{ kind: "dynamic", asset: { ...indexed.asset, descriptor: "Base token" }, match: "contract", source: "indexed" }], indexed.snapshots, "ok", null);
          const identity = await onchain(address);
          if (!identity) return response(normalized, offset, [], [], "ok", null);
          const asset = dynamicAsset(address, identity.symbol, identity.symbol, identity.decimals);
          return response(normalized, offset, [{ kind: "dynamic", asset, match: "contract", source: "onchain" }], [], "ok", null);
        }
        const payload = await executeCodexGraphql({ apiKey: apiKey.trim(), fetchImpl, timeoutMs, query: CODEX_SEARCH_QUERY, variables: { phrase: normalized, filters: { network: [8453] }, rankings: [{ attribute: "trendingScore24", direction: "DESC" }], limit: INVEST_SEARCH_PAGE_SIZE, offset } });
        const connection = readRecord(readRecord(payload)?.filterTokens);
        if (!connection || !Array.isArray(connection.results) || connection.results.length > INVEST_SEARCH_PAGE_SIZE || readPageInteger(connection.count) !== connection.results.length || readPageInteger(connection.page) !== offset) throw new Error("Invalid search page");
        const seen = new Set<string>();
        const rows: { result: InvestSearchWireResult; snapshot?: InvestSearchResponse["snapshots"][number] }[] = [];
        for (const row of connection.results) {
          const normalizedRow = normalizeTrendingMemes({ filterTokens: { results: [row] } }, now());
          const asset = normalizedRow.assets[0];
          if (!asset || configuredContracts.has(asset.contractAddress.toLowerCase()) || seen.has(asset.contractAddress.toLowerCase())) continue;
          seen.add(asset.contractAddress.toLowerCase());
          const match = matchAliases(normalized, [asset.displayName, asset.displaySymbol, asset.contractAddress]);
          if (!match) continue;
          const result: InvestSearchWireResult = { kind: "dynamic", asset: { ...asset, descriptor: "Base token" }, source: "indexed", match };
          rows.push({ result, snapshot: normalizedRow.snapshots[0] });
        }
        const ranked = rankInvestSearchResults([...configured, ...rows.map(({ result }) => result)].map((result) => ({
          result,
          match: result.match,
          source: result.kind === "configured" ? "configured" : result.source,
        }))).map(({ result }) => result);
        return response(normalized, offset, ranked, rows.flatMap(({ snapshot }) => snapshot ? [snapshot] : []), "ok", connection.results.length === INVEST_SEARCH_PAGE_SIZE && offset < INVEST_SEARCH_MAX_OFFSET ? offset + INVEST_SEARCH_PAGE_SIZE : null);
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
  if (!sharedReader || key !== sharedKey) { sharedKey = key; sharedReader = createCodexSearchReader({ apiKey: key }); }
  return sharedReader(request);
}
