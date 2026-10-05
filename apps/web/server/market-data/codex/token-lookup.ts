import "server-only";

import { readCodexApiKey } from "@/server/config/env";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import { sanitizeImageUrl } from "@/server/market-data/asset-icons/image-url";
import { createBoundedCache } from "@/server/cache/bounded";
import { parseExactDecimal } from "@/shared/balances/math";
import type { ExactDecimal } from "@/shared/balances/types";
import { parseAddress } from "@/shared/chain/hex";
import { CODEX_REQUEST_TIMEOUT_MS } from "./config";
import {
  executeCodexGraphql,
  readAddress,
  readInteger,
  readRecord,
  type FetchLike,
} from "./execute";

export const CODEX_TOKEN_LOOKUP_TTL_MS = 60_000;
export const CODEX_TOKEN_LOOKUP_BATCH_MAX = 100;
export const CODEX_TOKEN_LOOKUP_CACHE_MAX = 2_048;
const CODEX_TOKEN_LOOKUP_MAX_IN_FLIGHT = 2_048;

export const CODEX_TOKEN_LOOKUP_QUERY = `query BaseTokensByAddress(
  $tokens: [String!]
  $limit: Int
) {
  filterTokens(tokens: $tokens, limit: $limit) {
    results {
      liquidity
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

export type CodexTokenLookupEntry = {
  address: PortfolioAddress;
  name: string;
  symbol: string;
  decimals: number;
  imageUrl?: string;
  liquidityUsd?: ExactDecimal;
};

type CacheEntry = { value: CodexTokenLookupEntry | null };

type TokenLookupOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  maxInFlight?: number;
};

export function createCodexTokenLookup({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
  cacheTtlMs = CODEX_TOKEN_LOOKUP_TTL_MS,
  cacheMaxEntries = CODEX_TOKEN_LOOKUP_CACHE_MAX,
  maxInFlight = CODEX_TOKEN_LOOKUP_MAX_IN_FLIGHT,
}: TokenLookupOptions) {
  const cache = createBoundedCache<CacheEntry>({
    ttlMs: cacheTtlMs,
    maxEntries: cacheMaxEntries,
    maxInFlight,
    now: () => now().getTime(),
  });

  return async function lookupCodexTokens(
    addresses: readonly `0x${string}`[],
  ): Promise<Map<string, CodexTokenLookupEntry>> {
    const unique = [...new Set(addresses.map(parseAddress).filter(isPresent))];
    if (unique.length === 0 || !apiKey?.trim()) return new Map();

    const currentTime = now().getTime();
    if (!Number.isFinite(currentTime)) return new Map();
    const pending = new Map<string, Promise<CacheEntry | null>>();
    const enqueued: Array<{ address: PortfolioAddress; resolve: (entry: CacheEntry | PromiseLike<CacheEntry>) => void }> = [];

    for (const address of unique) {
      pending.set(address, cache.fetch(address, () => new Promise<CacheEntry>((resolve) => {
        enqueued.push({ address, resolve });
      })).then((result) => result.status === "saturated" ? null : result.value));
    }

    for (let index = 0; index < enqueued.length; index += CODEX_TOKEN_LOOKUP_BATCH_MAX) {
      const batch = enqueued.slice(index, index + CODEX_TOKEN_LOOKUP_BATCH_MAX);
      const entries = fetchTokenBatch({
        apiKey: apiKey.trim(),
        addresses: batch.map(({ address }) => address),
        fetchImpl,
        timeoutMs,
      });
      for (const item of batch) item.resolve(entries.then((found) => ({ value: found.get(item.address) ?? null })));
    }

    const settled = await Promise.all(
      [...pending].map(async ([address, request]) => {
        try {
          return [address, (await request)?.value ?? null] as const;
        } catch {
          return [address, null] as const;
        }
      }),
    );
    return new Map(settled.flatMap(([address, entry]) =>
      entry ? [[address, entry] as const] : [],
    ));
  };
}

let sharedLookup: ReturnType<typeof createCodexTokenLookup> | null = null;
let sharedApiKey: string | undefined;

export function getCodexTokenLookup(
  addresses: readonly `0x${string}`[],
): Promise<Map<string, CodexTokenLookupEntry>> {
  const apiKey = readCodexApiKey();
  if (!sharedLookup || sharedApiKey !== apiKey) {
    sharedApiKey = apiKey;
    sharedLookup = createCodexTokenLookup({ apiKey });
  }
  return sharedLookup(addresses);
}

async function fetchTokenBatch({
  apiKey,
  addresses,
  fetchImpl,
  timeoutMs,
}: {
  apiKey: string;
  addresses: readonly PortfolioAddress[];
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<Map<string, CodexTokenLookupEntry>> {
  const payload = await executeCodexGraphql({
    apiKey,
    query: CODEX_TOKEN_LOOKUP_QUERY,
    variables: {
      tokens: addresses.map((address) => `${address}:8453`),
      limit: addresses.length,
    },
    fetchImpl,
    timeoutMs,
  });
  const record = readRecord(payload);
  const connection = readRecord(record?.filterTokens);
  if (!connection || !Array.isArray(connection.results)) {
    throw new Error("Codex token lookup returned an invalid token list.");
  }

  const requested = new Set(addresses);
  const entries = new Map<string, CodexTokenLookupEntry>();
  const duplicates = new Set<string>();
  for (const value of connection.results) {
    const entry = normalizeTokenLookupEntry(value);
    if (!entry || !requested.has(entry.address)) continue;
    if (entries.has(entry.address) || duplicates.has(entry.address)) {
      entries.delete(entry.address);
      duplicates.add(entry.address);
      continue;
    }
    entries.set(entry.address, entry);
  }
  return entries;
}

export function normalizeTokenLookupEntry(
  value: unknown,
): CodexTokenLookupEntry | null {
  const row = readRecord(value);
  const token = readRecord(row?.token);
  if (!row || !token) return null;
  const address = readAddress(token.address)?.toLowerCase() as PortfolioAddress | undefined;
  const networkId = readInteger(token.networkId);
  const name = readBoundedText(token.name);
  const symbol = readBoundedText(token.symbol);
  const decimals = readInteger(token.decimals);
  if (
    !address ||
    networkId !== 8453 ||
    !name ||
    !symbol ||
    decimals === null ||
    decimals < 0 ||
    decimals > 255
  ) {
    return null;
  }

  const liquidityUsd = readNonNegativeExactDecimal(row.liquidity);
  const info = readRecord(token.info);
  const imageUrl =
    sanitizeImageUrl(info?.imageSmallUrl) ??
    sanitizeImageUrl(info?.imageThumbUrl) ??
    sanitizeImageUrl(info?.imageLargeUrl);
  return {
    address,
    name,
    symbol,
    decimals,
    ...(imageUrl ? { imageUrl } : {}),
    ...(liquidityUsd ? { liquidityUsd } : {}),
  };
}

function readBoundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
}

function readNonNegativeExactDecimal(value: unknown): ExactDecimal | null {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string" && value === value.trim()
      ? value
      : null;
  if (!raw || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return null;
  }
  return parseExactDecimal(raw);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
