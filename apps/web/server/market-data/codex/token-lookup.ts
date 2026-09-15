import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import { sanitizeImageUrl } from "@/server/market-data/asset-icons/image-url";
import { parseExactDecimal } from "@/shared/balances/math";
import type { ExactDecimal } from "@/shared/balances/types";
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

type CacheEntry = {
  storedAt: number;
  value: CodexTokenLookupEntry | null;
};

type TokenLookupOptions = {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
};

export function createCodexTokenLookup({
  apiKey,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
  cacheTtlMs = CODEX_TOKEN_LOOKUP_TTL_MS,
  cacheMaxEntries = CODEX_TOKEN_LOOKUP_CACHE_MAX,
}: TokenLookupOptions) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CodexTokenLookupEntry | null>>();

  return async function lookupCodexTokens(
    addresses: readonly `0x${string}`[],
  ): Promise<Map<string, CodexTokenLookupEntry>> {
    const unique = [...new Set(addresses.map(normalizeAddress).filter(isPresent))];
    if (unique.length === 0 || !apiKey?.trim()) return new Map();

    const currentTime = now().getTime();
    if (!Number.isFinite(currentTime)) return new Map();
    const pending = new Map<string, Promise<CodexTokenLookupEntry | null>>();
    const uncached: PortfolioAddress[] = [];

    for (const address of unique) {
      const cached = cache.get(address);
      if (cached && currentTime - cached.storedAt <= cacheTtlMs) {
        cache.delete(address);
        cache.set(address, cached);
        pending.set(address, Promise.resolve(cached.value));
        continue;
      }
      if (cached) cache.delete(address);
      const existing = inFlight.get(address);
      if (existing) pending.set(address, existing);
      else uncached.push(address);
    }

    for (
      let index = 0;
      index < uncached.length;
      index += CODEX_TOKEN_LOOKUP_BATCH_MAX
    ) {
      const batch = uncached.slice(index, index + CODEX_TOKEN_LOOKUP_BATCH_MAX);
      const batchRequest = fetchTokenBatch({
        apiKey: apiKey.trim(),
        addresses: batch,
        fetchImpl,
        timeoutMs,
      });
      for (const address of batch) {
        const request = batchRequest
          .then((entries) => {
            const value = entries.get(address) ?? null;
            setCacheEntry(
              cache,
              address,
              { storedAt: now().getTime(), value },
              cacheMaxEntries,
            );
            return value;
          })
          .finally(() => {
            if (inFlight.get(address) === request) inFlight.delete(address);
          });
        inFlight.set(address, request);
        pending.set(address, request);
      }
    }

    const settled = await Promise.all(
      [...pending].map(async ([address, request]) => {
        try {
          return [address, await request] as const;
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
  const apiKey = process.env.CODEX_API_KEY;
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

function normalizeAddress(value: string): PortfolioAddress | null {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase() as PortfolioAddress
    : null;
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

function setCacheEntry(
  cache: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry,
  maximum: number,
): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
