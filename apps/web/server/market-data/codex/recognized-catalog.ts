import "server-only";

import {
  getDirectPortfolioAssets,
  portfolioVaults,
  type PortfolioAddress,
} from "@/config/portfolio-assets";
import { sanitizeImageUrl } from "@/server/market-data/asset-icons/image-url";
import { parseExactDecimal } from "@/shared/portfolio/valuation-math";
import type { ExactDecimal } from "@/shared/portfolio/valuation-types";
import { CodexMarketDataError } from "./client";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";
import {
  executeCodexGraphql,
  readAddress,
  readInteger,
  readPositiveDecimal,
  readRecord,
  type FetchLike,
} from "./execute";

export const CODEX_RECOGNIZED_CATALOG_TTL_MS = 60_000;
export const CODEX_RECOGNIZED_PAGE_SIZE = 200;
export const CODEX_RECOGNIZED_CATALOG_LIMIT = 512;
export const CODEX_RECOGNIZED_OFFSETS = [0, 200, 400] as const;

export const CODEX_RECOGNIZED_CATALOG_QUERY = `query RecognizedBaseTokens(
  $filters: TokenFilters
  $rankings: [TokenRanking!]
  $limit: Int
  $offset: Int
) {
  filterTokens(filters: $filters, rankings: $rankings, limit: $limit, offset: $offset) {
    results {
      liquidity
      volume24
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

export type RecognizedTokenCatalogEntry = {
  address: PortfolioAddress;
  name: string;
  symbol: string;
  decimals: number;
  liquidityUsd: ExactDecimal;
  volume24Usd: ExactDecimal;
  imageUrl?: string;
};

export type RecognizedTokenCatalogResult = {
  status: "complete" | "incomplete";
  entries: RecognizedTokenCatalogEntry[];
};

type CatalogReaderOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
};

export function createCodexRecognizedTokenCatalogReader({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
}: CatalogReaderOptions) {
  let cache: { storedAt: number; result: RecognizedTokenCatalogResult } | null = null;
  let inFlight: Promise<RecognizedTokenCatalogResult> | null = null;

  return async function readRecognizedTokenCatalog(
    signal?: AbortSignal,
  ): Promise<RecognizedTokenCatalogResult> {
    if (!apiKey?.trim()) return { status: "incomplete", entries: [] };
    const currentTime = now().getTime();
    if (!Number.isFinite(currentTime)) {
      throw new CodexMarketDataError("The Codex catalog clock is invalid.");
    }
    if (cache && currentTime - cache.storedAt <= CODEX_RECOGNIZED_CATALOG_TTL_MS) {
      return cache.result;
    }
    if (inFlight) return inFlight;

    inFlight = fetchCatalog({
      apiKey: apiKey.trim(),
      fetchImpl,
      timeoutMs,
      signal,
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

let sharedReader: ReturnType<typeof createCodexRecognizedTokenCatalogReader> | null = null;
let sharedApiKey: string | undefined;

export function getCodexRecognizedTokenCatalog(
  signal?: AbortSignal,
): Promise<RecognizedTokenCatalogResult> {
  const apiKey = process.env.CODEX_API_KEY;
  if (!sharedReader || apiKey !== sharedApiKey) {
    sharedApiKey = apiKey;
    sharedReader = createCodexRecognizedTokenCatalogReader({ apiKey });
  }
  return sharedReader(signal);
}

export function clearCodexRecognizedTokenCatalogCacheForTests(): void {
  sharedReader = null;
  sharedApiKey = undefined;
}

async function fetchCatalog({
  apiKey,
  fetchImpl,
  timeoutMs,
  signal,
}: {
  apiKey: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<RecognizedTokenCatalogResult> {
  const pages = await Promise.all(
    CODEX_RECOGNIZED_OFFSETS.map(async (offset) => {
      try {
        const payload = await executeCodexGraphql({
          apiKey,
          query: CODEX_RECOGNIZED_CATALOG_QUERY,
          variables: {
            filters: {
              network: [8453],
              potentialScam: false,
              trendingIgnored: false,
            },
            rankings: [{ attribute: "liquidity", direction: "DESC" }],
            limit: CODEX_RECOGNIZED_PAGE_SIZE,
            offset,
          },
          fetchImpl,
          timeoutMs,
          signal,
        });
        return readCatalogPage(payload, offset);
      } catch {
        return null;
      }
    }),
  );
  return {
    status: pages.some((page) => page === null) ? "incomplete" : "complete",
    entries: normalizeRecognizedTokenCatalog(pages.flatMap((page) => page ?? [])),
  };
}

export function normalizeRecognizedTokenCatalog(
  rows: readonly unknown[],
): RecognizedTokenCatalogEntry[] {
  const configuredContracts = new Set(
    getDirectPortfolioAssets().flatMap((asset) =>
      asset.contractAddress ? [asset.contractAddress.toLowerCase()] : [],
    ),
  );
  const vaultContracts = new Set(
    portfolioVaults.map(({ address }) => address.toLowerCase()),
  );
  const configuredSymbols = new Set(
    getDirectPortfolioAssets().map(({ symbol }) => symbol.toLowerCase()),
  );
  const nativeAliases = new Set([
    "0x0000000000000000000000000000000000000000",
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  ]);
  const entries: RecognizedTokenCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const value of rows) {
    const row = readRecord(value);
    const token = readRecord(row?.token);
    if (!row || !token) continue;
    const address = readAddress(token.address);
    const networkId = readInteger(token.networkId);
    const name = readBoundedText(token.name);
    const symbol = readBoundedText(token.symbol);
    const decimals = readInteger(token.decimals);
    const rawLiquidity = readPositiveDecimal(row.liquidity);
    const rawVolume24 = readNonNegativeDecimal(row.volume24);
    const liquidityUsd = rawLiquidity ? parseExactDecimal(rawLiquidity) : null;
    const volume24Usd = rawVolume24 ? parseExactDecimal(rawVolume24) : null;
    if (
      !address ||
      networkId !== 8453 ||
      !name ||
      !symbol ||
      decimals === null ||
      decimals < 0 ||
      decimals > 255 ||
      !liquidityUsd ||
      BigInt(liquidityUsd.atoms) === BigInt(0) ||
      !volume24Usd
    ) {
      continue;
    }

    const key = address.toLowerCase();
    if (
      seen.has(key) ||
      configuredContracts.has(key) ||
      vaultContracts.has(key) ||
      nativeAliases.has(key) ||
      configuredSymbols.has(symbol.toLowerCase())
    ) {
      continue;
    }
    seen.add(key);
    const info = readRecord(token.info);
    const imageUrl =
      sanitizeImageUrl(info?.imageSmallUrl) ??
      sanitizeImageUrl(info?.imageThumbUrl) ??
      sanitizeImageUrl(info?.imageLargeUrl);
    entries.push({
      address: key as PortfolioAddress,
      name,
      symbol,
      decimals,
      liquidityUsd,
      volume24Usd,
      ...(imageUrl ? { imageUrl } : {}),
    });
    if (entries.length === CODEX_RECOGNIZED_CATALOG_LIMIT) break;
  }
  return entries;
}

function readCatalogPage(data: unknown, offset: number): unknown[] {
  const record = readRecord(data);
  const connection = readRecord(record?.filterTokens);
  if (!connection || !Array.isArray(connection.results)) {
    throw new CodexMarketDataError("Codex recognized catalog returned an invalid token list.");
  }
  const count = readInteger(connection.count);
  const page = readInteger(connection.page);
  if (count !== connection.results.length || page !== offset) {
    throw new CodexMarketDataError("Codex recognized catalog returned invalid pagination metadata.");
  }
  return connection.results;
}

function readBoundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

function readNonNegativeDecimal(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string" || value !== value.trim()) return null;
  return /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
    ? value
    : null;
}
