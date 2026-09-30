import "server-only";

import type { FiatCurrencyCode } from "@/config/regions";
import { parseExactDecimal } from "@/shared/balances/math";
import type { ExactDecimal } from "@/shared/balances/types";
import type { FetchLike } from "@/server/market-data/codex/execute";
import { createBoundedCache } from "@/server/cache/bounded";
import { createWriteOrder } from "@/server/cache/write-order";

export const COINBASE_DAILY_FX_ORIGIN = "https://api.coinbase.com" as const;
export const ACTIVITY_FX_TIMEOUT_MS = 3_000;
export const ACTIVITY_FX_MAX_CONCURRENCY = 4;
export const ACTIVITY_FX_CACHE_MAX_ENTRIES = 512;
export const ACTIVITY_FX_SETTLED_TTL_MS = 24 * 60 * 60 * 1_000;
export const ACTIVITY_FX_PROVISIONAL_TTL_MS = 60_000;

export type DailyFxRequest = {
  base: FiatCurrencyCode;
  quote: FiatCurrencyCode;
  date: string;
};

export type DailyFxResult = { rate: ExactDecimal; provisional: boolean } | null;

export type DailyFxReader = (
  requests: readonly DailyFxRequest[],
  signal?: AbortSignal,
) => Promise<Map<string, DailyFxResult>>;

export function dailyFxKey(request: DailyFxRequest): string {
  return `${request.base}:${request.quote}:${request.date}`;
}

export function coinbaseDailyFxUrl(request: DailyFxRequest): string {
  return `${COINBASE_DAILY_FX_ORIGIN}/v2/prices/${request.base}-${request.quote}/spot?date=${request.date}`;
}

export function createCoinbaseDailyFxReader(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  cacheMaxEntries?: number;
  writeOrder?: ReturnType<typeof createWriteOrder>;
} = {}): DailyFxReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? ACTIVITY_FX_TIMEOUT_MS;
  const cacheMaxEntries = options.cacheMaxEntries ?? ACTIVITY_FX_CACHE_MAX_ENTRIES;
  const writeOrder = options.writeOrder ?? createWriteOrder();
  const cache = createBoundedCache<{ storedAt: number; value: NonNullable<DailyFxResult> }>({
    maxEntries: cacheMaxEntries, ttlMs: ACTIVITY_FX_SETTLED_TTL_MS, maxInFlight: 1,
    now: () => now().getTime(),
  });

  return async function readDailyFx(requests, signal) {
    const unique = new Map<string, DailyFxRequest>();
    for (const request of requests) {
      if (request.base !== request.quote && /^\d{4}-\d{2}-\d{2}$/.test(request.date)) {
        unique.set(dailyFxKey(request), request);
      }
    }
    const results = new Map<string, DailyFxResult>();
    const missing: [string, DailyFxRequest][] = [];
    const currentMs = now().getTime();
    const currentDate = new Date(currentMs).toISOString().slice(0, 10);
    for (const [key, request] of unique) {
      const cached = cache.peek(key);
      if (
        cached &&
        (!cached.value.provisional || (
          currentMs - cached.storedAt <= ACTIVITY_FX_PROVISIONAL_TTL_MS &&
          !(request.date < currentDate)
        ))
      ) {
        cache.get(key);
        results.set(key, cached.value);
      } else {
        missing.push([key, request]);
      }
    }

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(ACTIVITY_FX_MAX_CONCURRENCY, missing.length) },
      async () => {
        while (cursor < missing.length && !signal?.aborted) {
          const entry = missing[cursor];
          cursor += 1;
          if (!entry) break;
          const [key, request] = entry;
          const today = now().toISOString().slice(0, 10);
          if (request.date > today) {
            results.set(key, null);
            continue;
          }
          const provisional = request.date === today;
          const rate = await writeOrder.settle(
            key,
            fetchDailyRate({ request, fetchImpl, timeoutMs, signal }),
            (rate) => {
              if (!rate) return false;
              cache.set(key, { storedAt: now().getTime(), value: { rate, provisional } });
              return true;
            },
          );
          if (!rate) {
            results.set(key, null);
            continue;
          }
          const value = { rate, provisional };
          results.set(key, value);
        }
      },
    );
    await Promise.all(workers);
    return results;
  };
}

async function fetchDailyRate({
  request,
  fetchImpl,
  timeoutMs,
  signal,
}: {
  request: DailyFxRequest;
  fetchImpl: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ExactDecimal | null> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(coinbaseDailyFxUrl(request), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return readRate(await response.json(), request);
  } catch (error) {
    void error;
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function readRate(payload: unknown, request: DailyFxRequest): ExactDecimal | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const { amount, base, currency } = payload.data;
  if (base !== request.base || currency !== request.quote || typeof amount !== "string") {
    return null;
  }
  const rate = parseExactDecimal(amount);
  return rate && rate.atoms !== "0" ? rate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
