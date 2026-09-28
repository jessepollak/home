import "server-only";

import { investAssets, initialsFromSymbol, trendingTokenId, type InvestAsset } from "@/config/invest-assets";
import { baseRpc } from "@/server/chain/rpc";
import { readsToken0 } from "@/server/chain/pair";
import { createActivityTokenRpcResolver } from "@/server/activity/token-metadata-rpc";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { ASSET_RESOLUTION_VERSION, type AssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";
import { CODEX_REQUEST_TIMEOUT_MS } from "./codex/config";
import { executeCodexGraphql, readAddress, readInteger, readRecord, type FetchLike } from "./codex/execute";
import { normalizeTrendingMemes } from "./codex/trending";

export const CODEX_ASSET_QUERY = `query ResolveBaseTokenByAddress($tokens: [String!], $limit: Int) {
  filterTokens(tokens: $tokens, limit: $limit) {
    results { priceUSD change24 lastTransaction token { address name symbol decimals networkId info { imageThumbUrl imageSmallUrl imageLargeUrl } } }
  }
}`;

const resolveRpcMetadata = createActivityTokenRpcResolver();

type Onchain = (address: `0x${string}`) => Promise<{ symbol: string; decimals: number } | null>;
export type AssetResolverOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  onchain?: Onchain;
  isPair?: (address: `0x${string}`) => Promise<boolean | null>;
  now?: () => Date;
  timeoutMs?: number;
  cacheMaxEntries?: number;
  maxInFlight?: number;
};

export function assetReadsToken0(address: `0x${string}`): Promise<boolean | null> {
  return readsToken0(address, (method, params) => baseRpc(method, params, { timeoutMs: 3_000 }));
}

export async function readOnchainIdentity(address: `0x${string}`): Promise<{ symbol: string; decimals: number } | null> {
  const value = (await resolveRpcMetadata([address])).get(address.toLowerCase());
  return value?.kind === "metadata" && value.symbol.trim() && value.symbol.length <= 64
    ? { symbol: value.symbol.trim(), decimals: value.decimals }
    : null;
}

function dynamicAsset(address: `0x${string}`, symbol: string, decimals: number): InvestAsset {
  return {
    id: trendingTokenId(address), category: "meme", displayName: symbol, displaySymbol: symbol,
    initials: initialsFromSymbol(symbol), chainId: 8453, contractAddress: address,
    availability: "informational", descriptor: "Base token",
    representation: { tokenSymbol: symbol, decimals, relationship: "Base ERC-20 token; the display and token symbols are the same." },
    contractUrl: `https://basescan.org/token/${address}`,
  };
}

export function createAssetResolver({ apiKey, fetchImpl = fetch, onchain = readOnchainIdentity, isPair = assetReadsToken0, now = () => new Date(), timeoutMs = CODEX_REQUEST_TIMEOUT_MS, cacheMaxEntries = 256, maxInFlight = 8 }: AssetResolverOptions) {
  const cache = new Map<string, { storedAt: number; value: AssetResolutionResponse }>();
  const inFlight = new Map<string, Promise<AssetResolutionResponse>>();
  return async function resolveAsset(identity: string): Promise<AssetResolutionResponse> {
    const addressInput = /^0x[0-9a-f]{40}$/i.test(identity) ? identity.toLowerCase() : null;
    const configured = investAssets.find((asset) => asset.id === identity || asset.contractAddress.toLowerCase() === addressInput);
    const parsed = configured ? null : resolveMarketPriceAssetIdentity(addressInput ? trendingTokenId(addressInput as `0x${string}`) : identity);
    const assetId = configured?.id ?? parsed?.assetId ?? identity;
    const response = (provider: AssetResolutionResponse["provider"], asset: InvestAsset | null = null, source: AssetResolutionResponse["source"] = null, snapshot: AssetResolutionResponse["snapshot"] = null): AssetResolutionResponse => ({ version: ASSET_RESOLUTION_VERSION, assetId, asset, source, snapshot, provider });
    if (configured) return response("skipped", configured, "configured");
    if (!parsed) return response("skipped");
    if (!apiKey?.trim()) return response("unavailable");
    const address = parsed.contractAddress;
    const timestamp = now().getTime();
    for (const [key, value] of cache) if (timestamp - value.storedAt > 45_000) cache.delete(key);
    const hit = cache.get(assetId);
    if (hit) { cache.delete(assetId); cache.set(assetId, hit); return hit.value; }
    const pending = inFlight.get(assetId);
    if (pending) return pending;
    if (inFlight.size >= maxInFlight) return response("unavailable");
    const readIndexed = async (): Promise<{ asset: InvestAsset; snapshot: AssetResolutionResponse["snapshot"] } | null> => {
      const payload = await executeCodexGraphql({ apiKey: apiKey.trim(), fetchImpl, timeoutMs, query: CODEX_ASSET_QUERY, variables: { tokens: [`${address}:8453`], limit: 1 } });
      const connection = readRecord(readRecord(payload)?.filterTokens);
      if (!connection || !Array.isArray(connection.results) || connection.results.length > 1) throw new Error("Invalid exact asset response");
      if (connection.results.length === 0) return null;
      const token = readRecord(readRecord(connection.results[0])?.token);
      const returnedAddress = readAddress(token?.address);
      const networkId = readInteger(token?.networkId);
      if (!returnedAddress || networkId === null) throw new Error("Invalid exact asset token");
      if (returnedAddress.toLowerCase() !== address || networkId !== 8453) return null;
      const normalized = normalizeTrendingMemes(payload, now());
      const asset = normalized.assets.find((candidate) => candidate.contractAddress.toLowerCase() === address && candidate.id === assetId);
      if (!asset) return null;
      return { asset: { ...asset, descriptor: "Base token" }, snapshot: normalized.snapshots.find((snapshot) => snapshot.assetId === assetId) ?? null };
    };
    const request = (async () => {
      try {
        const indexed = await readIndexed();
        const pair = await isPair(address);
        if (pair === null) return response("error");
        if (pair) return response("ok");
        if (indexed) return response("ok", indexed.asset, "indexed", indexed.snapshot);
        const identity = await onchain(address);
        if (!identity) return response("ok");
        return response("ok", dynamicAsset(address, identity.symbol, identity.decimals), "onchain");
      } catch { return response("error"); }
    })();
    inFlight.set(assetId, request);
    try {
      const value = await request;
      if (value.provider === "ok" && value.asset) {
        cache.set(assetId, { storedAt: now().getTime(), value });
        while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value!);
      }
      return value;
    } finally { inFlight.delete(assetId); }
  };
}

let sharedResolver: ReturnType<typeof createAssetResolver> | null = null;
let sharedKey: string | undefined;
export function resolveAsset(identity: string): Promise<AssetResolutionResponse> {
  const key = process.env.CODEX_API_KEY;
  if (!sharedResolver || key !== sharedKey) { sharedKey = key; sharedResolver = createAssetResolver({ apiKey: key }); }
  return sharedResolver(identity);
}
