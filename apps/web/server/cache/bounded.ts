import "server-only";

import { LRUCache } from "lru-cache";

export type BoundedCacheOptions = {
  maxEntries: number;
  ttlMs: number;
  maxInFlight: number;
  now?: () => number;
};

export type BoundedFetchResult<V> =
  | { status: "hit"; value: V }
  | { status: "loaded"; value: V }
  | { status: "saturated" };

type Flight<V> = { promise: Promise<BoundedFetchResult<V>>; current: boolean };

export function createBoundedCache<V extends NonNullable<unknown>>({
  maxEntries,
  ttlMs,
  maxInFlight,
  now = Date.now,
}: BoundedCacheOptions) {
  if (!Number.isInteger(maxEntries) || maxEntries < 0) {
    throw new RangeError("maxEntries must be a nonnegative integer");
  }
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive integer");
  }
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1) {
    throw new RangeError("maxInFlight must be a positive integer");
  }

  const store = maxEntries === 0
    ? null
    : new LRUCache<string, V>({
        max: maxEntries,
        ttl: ttlMs,
        updateAgeOnGet: false,
        ttlAutopurge: false,
        ttlResolution: 0,
        perf: { now: () => now() + 1 },
      });
  const joinable = new Map<string, Flight<V>>();
  let running = 0;

  function remember(key: string, value: V) {
    if (!store) return;
    store.purgeStale();
    store.set(key, value);
  }

  function invalidate(key: string) {
    const flight = joinable.get(key);
    if (!flight) return;
    flight.current = false;
    joinable.delete(key);
  }

  function fetch(
    key: string,
    load: () => Promise<V>,
    options: { capacity?: number } = {},
  ): Promise<BoundedFetchResult<V>> {
    const cached = store?.get(key);
    if (cached !== undefined) return Promise.resolve({ status: "hit", value: cached });

    const existing = joinable.get(key);
    if (existing) return existing.promise;

    const capacity = Math.min(options.capacity ?? maxInFlight, maxInFlight);
    if (!(capacity > running)) return Promise.resolve({ status: "saturated" });

    let settle!: (request: Promise<V>) => void;
    const request = new Promise<V>((resolve) => {
      settle = resolve;
    });
    const flight: Flight<V> = {
      current: true,
      promise: request
        .then((value): BoundedFetchResult<V> => {
          if (flight.current) remember(key, value);
          return { status: "loaded", value };
        })
        .finally(() => {
          running -= 1;
          if (joinable.get(key) === flight) joinable.delete(key);
        }),
    };
    running += 1;
    joinable.set(key, flight);
    try {
      settle(load());
    } catch (error) {
      settle(Promise.reject(error));
    }
    return flight.promise;
  }

  return {
    get: (key: string): V | undefined => store?.get(key),
    set: (key: string, value: V): void => {
      invalidate(key);
      remember(key, value);
    },
    delete: (key: string): void => {
      invalidate(key);
      store?.delete(key);
    },
    clear: (): void => {
      for (const key of [...joinable.keys()]) invalidate(key);
      store?.clear();
    },
    fetch,
    get size() {
      store?.purgeStale();
      return store?.size ?? 0;
    },
    get inFlight() {
      return running;
    },
  };
}
