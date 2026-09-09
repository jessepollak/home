import {
  BASE_CHAIN_ID,
  cryptoAssets,
  findInvestAssetByAddress,
  initialsFromSymbol,
  stockAssets,
  trendingTokenId,
  type InvestAsset,
} from "@/config/invest-assets";
import type { MarketSnapshot } from "@/features/invest/invest-market";
import { sanitizeImageUrl } from "../asset-icons/image-url";
import { formatChangeLabel } from "./change-label";
import { CodexMarketDataError } from "./client";
import {
  CODEX_CACHE_TTL_MS,
  CODEX_PRICE_SOURCE_LABEL,
  CODEX_REQUEST_TIMEOUT_MS,
} from "./config";
import {
  executeCodexGraphql,
  readAddress,
  readInteger,
  readPositiveDecimal,
  readRecord,
  type FetchLike,
} from "./execute";

export const CODEX_TRENDING_SOURCE_URL =
  "https://docs.codex.io/api-reference/queries/filtertokens";
export const CODEX_TRENDING_LIMIT = 12;
export const CODEX_TRENDING_MEME_CATEGORY = "memes";

export const CODEX_TRENDING_QUERY = `query FilterTrendingMemes(
  $filters: TokenFilters
  $rankings: [TokenRanking!]
  $limit: Int
  $excludeTokens: [String!]
) {
  filterTokens(
    filters: $filters
    rankings: $rankings
    limit: $limit
    excludeTokens: $excludeTokens
  ) {
    results {
      priceUSD
      change24
      lastTransaction
      token {
        address
        name
        symbol
        decimals
        networkId
        info {
          imageThumbUrl
          imageSmallUrl
          imageLargeUrl
        }
      }
    }
  }
}`;

export type TrendingMemesStatus =
  | "ready"
  | "empty"
  | "error"
  | "unavailable";

export type TrendingMemesResult = {
  status: TrendingMemesStatus;
  message?: string;
  assets: InvestAsset[];
  snapshots: MarketSnapshot[];
};

type Clock = () => Date;

type TrendingReaderOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
};

type CachedTrending = {
  storedAt: number;
  result: TrendingMemesResult;
};

const excludedDiscoverTokens = [...stockAssets, ...cryptoAssets].map(
  (asset) => `${asset.contractAddress.toLowerCase()}:${asset.chainId}`,
);

export function createCodexTrendingMemesReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: TrendingReaderOptions) {
  let cache: CachedTrending | null = null;
  let inFlight: Promise<TrendingMemesResult> | null = null;

  return async function readTrendingMemes(): Promise<TrendingMemesResult> {
    if (!apiKey?.trim()) {
      return { status: "unavailable", assets: [], snapshots: [] };
    }

    const currentTime = now().getTime();
    if (cache && currentTime - cache.storedAt <= CODEX_CACHE_TTL_MS) {
      return cache.result;
    }
    if (inFlight) return inFlight;

    inFlight = fetchTrendingMemes({
      apiKey: apiKey.trim(),
      fetchImpl,
      now,
      timeoutMs,
    });

    try {
      const result = await inFlight;
      cache = { storedAt: now().getTime(), result };
      return result;
    } finally {
      inFlight = null;
    }
  };
}

let sharedReader: ReturnType<typeof createCodexTrendingMemesReader> | null =
  null;
let sharedKey: string | undefined;

export function getCodexTrendingMemes(): Promise<TrendingMemesResult> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || sharedKey !== apiKey) {
    sharedKey = apiKey;
    sharedReader = createCodexTrendingMemesReader({ apiKey });
  }
  return sharedReader();
}

export function clearCodexTrendingMemesCacheForTests() {
  sharedReader = null;
  sharedKey = undefined;
}

export function createUnavailableTrendingMemes(): TrendingMemesResult {
  return { status: "unavailable", assets: [], snapshots: [] };
}

export function createErrorTrendingMemes(
  message = "Trending memes are unavailable.",
): TrendingMemesResult {
  return { status: "error", message, assets: [], snapshots: [] };
}

async function fetchTrendingMemes({
  apiKey,
  fetchImpl,
  now,
  timeoutMs,
}: {
  apiKey: string;
  fetchImpl: FetchLike;
  now: Clock;
  timeoutMs: number;
}): Promise<TrendingMemesResult> {
  const payload = await executeCodexGraphql({
    apiKey,
    query: CODEX_TRENDING_QUERY,
    variables: {
      filters: {
        network: [BASE_CHAIN_ID],
        potentialScam: false,
        trendingIgnored: false,
        categories: { anyOf: [CODEX_TRENDING_MEME_CATEGORY] },
      },
      rankings: [{ attribute: "trendingScore24", direction: "DESC" }],
      limit: CODEX_TRENDING_LIMIT,
      excludeTokens: excludedDiscoverTokens,
    },
    fetchImpl,
    timeoutMs,
  });

  const fetchedAt = now();
  return normalizeTrendingMemes(payload, fetchedAt);
}

export function normalizeTrendingMemes(
  data: unknown,
  fetchedAt: Date,
): TrendingMemesResult {
  const record = readRecord(data);
  const connection = readRecord(record?.filterTokens);
  if (!connection || !Array.isArray(connection.results)) {
    throw new CodexMarketDataError(
      "Codex trending returned an invalid token list.",
    );
  }

  const assets: InvestAsset[] = [];
  const snapshots: MarketSnapshot[] = [];
  const seen = new Set<string>();

  for (const value of connection.results) {
    const asset = readTrendingAsset(value);
    if (!asset) continue;
    const key = asset.contractAddress.toLowerCase();
    if (seen.has(key)) continue;
    if (isConfiguredStockOrCrypto(key)) continue;
    seen.add(key);
    assets.push(asset);

    const snapshot = readTrendingSnapshot(value, asset.id, fetchedAt);
    if (snapshot) snapshots.push(snapshot);
  }

  if (assets.length === 0) {
    return { status: "empty", assets: [], snapshots: [] };
  }

  return { status: "ready", assets, snapshots };
}

function readTrendingAsset(value: unknown): InvestAsset | null {
  const result = readRecord(value);
  const token = readRecord(result?.token);
  if (!token) return null;

  const address = readAddress(token.address);
  const networkId = readInteger(token.networkId);
  if (!address || networkId !== BASE_CHAIN_ID) return null;

  const configured = findInvestAssetByAddress(address);
  const info = readRecord(token.info);
  const imageUrl =
    sanitizeImageUrl(info?.imageSmallUrl) ??
    sanitizeImageUrl(info?.imageThumbUrl) ??
    sanitizeImageUrl(info?.imageLargeUrl) ??
    configured?.imageUrl;

  if (configured?.category === "meme") {
    return imageUrl ? { ...configured, imageUrl } : { ...configured };
  }

  const symbol =
    readNonEmptyString(token.symbol) ??
    readNonEmptyString(configured?.displaySymbol);
  const name =
    readNonEmptyString(token.name) ??
    readNonEmptyString(configured?.displayName) ??
    symbol;
  if (!symbol || !name) return null;

  const decimals = readInteger(token.decimals);
  if (decimals === null || decimals < 0 || decimals > 36) return null;

  return {
    id: trendingTokenId(address),
    category: "meme",
    displayName: name,
    displaySymbol: symbol,
    initials: initialsFromSymbol(symbol),
    chainId: BASE_CHAIN_ID,
    contractAddress: address,
    availability: "informational",
    descriptor: "Trending on Base",
    representation: {
      tokenSymbol: symbol,
      decimals,
      relationship: "Base ERC-20 token; the display and token symbols are the same.",
    },
    contractUrl: `https://basescan.org/token/${address}`,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function readTrendingSnapshot(
  value: unknown,
  assetId: string,
  fetchedAt: Date,
): MarketSnapshot | null {
  const result = readRecord(value);
  if (!result) return null;
  const priceUsd = readPositiveDecimal(result.priceUSD);
  if (!priceUsd) return null;

  const lastTransaction = readInteger(result.lastTransaction);
  const asOf =
    lastTransaction !== null && lastTransaction > 0
      ? new Date(lastTransaction * 1_000)
      : fetchedAt;
  if (Number.isNaN(asOf.getTime())) return null;

  const changeLabel = formatChangeLabel(result.change24);
  return {
    assetId,
    displayPrice: `$${priceUsd}`,
    asOf: asOf.toISOString(),
    sourceLabel: CODEX_PRICE_SOURCE_LABEL,
    sourceUrl: CODEX_TRENDING_SOURCE_URL,
    ...(changeLabel ? { changeLabel } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : undefined;
}

function isConfiguredStockOrCrypto(address: string): boolean {
  return excludedDiscoverTokens.some((token) => token.startsWith(`${address}:`));
}
