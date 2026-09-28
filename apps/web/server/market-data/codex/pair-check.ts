import "server-only";

export type PairCheck = (address: `0x${string}`) => Promise<boolean | null>;

export function createPairCheck({ read, maxConcurrent, cacheMaxEntries, ttlMs, now = Date.now }: {
  read: PairCheck;
  maxConcurrent: number;
  cacheMaxEntries: number;
  ttlMs: number;
  now?: () => number;
}): PairCheck {
  const cache = new Map<string, { value: boolean; expiresAt: number }>();
  const inFlight = new Map<string, Promise<boolean | null>>();
  const waiting: (() => void)[] = [];
  let running = 0;

  async function limitedRead(address: `0x${string}`): Promise<boolean | null> {
    if (running >= maxConcurrent) await new Promise<void>((resolve) => { waiting.push(resolve); });
    else running++;
    try {
      return await read(address);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  }

  return function checkPair(address) {
    const key = address.toLowerCase();
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      if (now() < cached.expiresAt) {
        cache.set(key, cached);
        return Promise.resolve(cached.value);
      }
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = limitedRead(address).then((result) => {
      if (result !== null) {
        cache.delete(key);
        cache.set(key, { value: result, expiresAt: now() + ttlMs });
        while (cache.size > cacheMaxEntries) cache.delete(cache.keys().next().value!);
      }
      return result;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, request);
    return request;
  };
}
