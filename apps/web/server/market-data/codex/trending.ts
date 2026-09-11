import "server-only";

import {
  BASE_CHAIN_ID,
  cryptoAssets,
  findInvestAssetByAddress,
  initialsFromSymbol,
  stockAssets,
  trendingTokenId,
  type InvestAsset,
} from "@/config/invest-assets";
import type { MarketSnapshot } from "@/shared/invest/invest-market";
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
/**
 * One scroll page of trending memes. Chosen to be a comfortable mobile batch
 * while staying well under Codex's 200-row-per-request bound.
 */
export const CODEX_TRENDING_PAGE_SIZE = 24;
export const CODEX_TRENDING_MAX_PAGE_SIZE = 200;
/**
 * Backwards-compatible alias: the first-page catalog read (dynamic history
 * admission and the discover initial page) uses the same bounded page size.
 */
export const CODEX_TRENDING_LIMIT = CODEX_TRENDING_PAGE_SIZE;
export const CODEX_TRENDING_MEME_CATEGORY = "memes";

export const CODEX_TRENDING_QUERY = `query FilterTrendingMemes(
  $filters: TokenFilters
  $rankings: [TokenRanking!]
  $limit: Int
  $offset: Int
  $excludeTokens: [String!]
) {
  filterTokens(
    filters: $filters
    rankings: $rankings
    limit: $limit
    offset: $offset
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
    count
    page
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

export type TrendingMemesPage = TrendingMemesResult & {
  /** Offset to request for the next page, or null when there is no next page. */
  nextOffset: number | null;
  /** True once the provider returned fewer rows than the requested page size. */
  exhausted: boolean;
};

type Clock = () => Date;

type TrendingReaderOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
};

type TrendingPageOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: Clock;
  timeoutMs?: number;
};

type CachedTrending = {
  storedAt: number;
  result: TrendingMemesResult;
};

type CachedTrendingPage = {
  storedAt: number;
  result: TrendingMemesPage;
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

/**
 * Offset-paginated reader used by the discover API. Each offset keeps its own
 * 45-second cache entry and in-flight coalescing so a scroll storm does not
 * re-request the same page or exceed the provider budget.
 */
export function createCodexTrendingMemesPageReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: TrendingPageOptions) {
  const cache = new Map<string, CachedTrendingPage>();
  const inFlight = new Map<string, Promise<TrendingMemesPage>>();

  return async function readTrendingMemesPage(
    offset: number,
  ): Promise<TrendingMemesPage> {
    if (!apiKey?.trim()) return createUnavailableTrendingMemesPage();

    const safeOffset = clampTrendingOffset(offset);
    const limit = CODEX_TRENDING_PAGE_SIZE;
    const key = `${safeOffset}:${limit}`;

    const currentTime = now().getTime();
    const cached = cache.get(key);
    if (cached && currentTime - cached.storedAt <= CODEX_CACHE_TTL_MS) {
      return cached.result;
    }
    const existing = inFlight.get(key);
    if (existing) return existing;

    const pending = fetchTrendingMemesPage({
      apiKey: apiKey.trim(),
      fetchImpl,
      now,
      timeoutMs,
      offset: safeOffset,
      limit,
    });
    inFlight.set(key, pending);
    try {
      const result = await pending;
      cache.set(key, { storedAt: now().getTime(), result });
      return result;
    } finally {
      inFlight.delete(key);
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

let sharedPageReader: ReturnType<typeof createCodexTrendingMemesPageReader> | null =
  null;
let sharedPageKey: string | undefined;

export function getCodexTrendingMemesPage(
  offset: number,
): Promise<TrendingMemesPage> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedPageReader || sharedPageKey !== apiKey) {
    sharedPageKey = apiKey;
    sharedPageReader = createCodexTrendingMemesPageReader({ apiKey });
  }
  return sharedPageReader(offset);
}

export function clearCodexTrendingMemesCacheForTests() {
  sharedReader = null;
  sharedKey = undefined;
  sharedPageReader = null;
  sharedPageKey = undefined;
}

export function createUnavailableTrendingMemes(): TrendingMemesResult {
  return { status: "unavailable", assets: [], snapshots: [] };
}

export function createErrorTrendingMemes(
  message = "Trending memes are unavailable.",
): TrendingMemesResult {
  return { status: "error", message, assets: [], snapshots: [] };
}

export function createUnavailableTrendingMemesPage(): TrendingMemesPage {
  return {
    status: "unavailable",
    assets: [],
    snapshots: [],
    nextOffset: null,
    exhausted: true,
  };
}

export function createErrorTrendingMemesPage(
  message = "Trending memes are unavailable.",
): TrendingMemesPage {
  return {
    status: "error",
    message,
    assets: [],
    snapshots: [],
    nextOffset: null,
    exhausted: true,
  };
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
  const page = await fetchTrendingMemesPage({
    apiKey,
    fetchImpl,
    now,
    timeoutMs,
    offset: 0,
    limit: CODEX_TRENDING_LIMIT,
  });
  return stripTrendingPagination(page);
}

async function fetchTrendingMemesPage({
  apiKey,
  fetchImpl,
  now,
  timeoutMs,
  offset,
  limit,
}: {
  apiKey: string;
  fetchImpl: FetchLike;
  now: Clock;
  timeoutMs: number;
  offset: number;
  limit: number;
}): Promise<TrendingMemesPage> {
  const safeLimit = clampTrendingPageLimit(limit);
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
      limit: safeLimit,
      offset,
      excludeTokens: excludedDiscoverTokens,
    },
    fetchImpl,
    timeoutMs,
  });

  const fetchedAt = now();
  return normalizeTrendingMemesPage(payload, fetchedAt, {
    offset,
    limit: safeLimit,
  });
}

function stripTrendingPagination(page: TrendingMemesPage): TrendingMemesResult {
  return {
    status: page.status,
    ...(page.message ? { message: page.message } : {}),
    assets: page.assets,
    snapshots: page.snapshots,
  };
}

export function normalizeTrendingMemes(
  data: unknown,
  fetchedAt: Date,
): TrendingMemesResult {
  const connection = readTrendingConnection(data);
  const { assets, snapshots } = normalizeTrendingRows(connection, fetchedAt);

  if (assets.length === 0) {
    return { status: "empty", assets: [], snapshots: [] };
  }

  return { status: "ready", assets, snapshots };
}

export function normalizeTrendingMemesPage(
  data: unknown,
  fetchedAt: Date,
  { offset, limit }: { offset: number; limit: number },
): TrendingMemesPage {
  const connection = readTrendingConnection(data);
  const providerReturned = readTrendingPageMeta(connection, offset);
  const { assets, snapshots } = normalizeTrendingRows(connection, fetchedAt);

  const exhausted = providerReturned < limit;
  const nextOffset = exhausted ? null : offset + providerReturned;

  return {
    status: assets.length === 0 ? "empty" : "ready",
    assets,
    snapshots,
    nextOffset,
    exhausted,
  };
}

function readTrendingConnection(data: unknown): Record<string, unknown> {
  const record = readRecord(data);
  const connection = readRecord(record?.filterTokens);
  if (!connection || !Array.isArray(connection.results)) {
    throw new CodexMarketDataError(
      "Codex trending returned an invalid token list.",
    );
  }
  return connection;
}

function normalizeTrendingRows(
  connection: Record<string, unknown>,
  fetchedAt: Date,
): { assets: InvestAsset[]; snapshots: MarketSnapshot[] } {
  const assets: InvestAsset[] = [];
  const snapshots: MarketSnapshot[] = [];
  const seen = new Set<string>();

  const results = connection.results as unknown[];
  for (const value of results) {
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

  return { assets, snapshots };
}

/**
 * Reads and validates the provider's `count`/`page` metadata. `page` must equal
 * the requested offset — this is the truthfulness guard that prevents a silent
 * "repeated page one" regression — and `count` must equal the number of rows in
 * this page so the next offset advances by real provider results, never by a
 * client-side dedup count.
 */
function readTrendingPageMeta(
  connection: Record<string, unknown>,
  offset: number,
): number {
  const count = readInteger(connection.count);
  const page = readInteger(connection.page);
  if (count === null || page === null) {
    throw new CodexMarketDataError(
      "Codex trending returned invalid pagination metadata.",
    );
  }
  if (page !== offset) {
    throw new CodexMarketDataError(
      "Codex trending page did not match the requested offset.",
    );
  }
  const resultsLength = (connection.results as unknown[]).length;
  if (count !== resultsLength) {
    throw new CodexMarketDataError(
      "Codex trending returned an inconsistent result count.",
    );
  }
  return resultsLength;
}

function clampTrendingOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
}

function clampTrendingPageLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return CODEX_TRENDING_PAGE_SIZE;
  return Math.min(Math.floor(limit), CODEX_TRENDING_MAX_PAGE_SIZE);
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
