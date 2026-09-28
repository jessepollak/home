import "server-only";

import { createBoundedCache } from "@/server/cache/bounded";

export type PairCheck = (address: `0x${string}`) => Promise<boolean | null>;
const CODEX_PAIR_CHECK_MAX_IN_FLIGHT = 512;

export function createPairCheck({ read, maxConcurrent, maxInFlight = CODEX_PAIR_CHECK_MAX_IN_FLIGHT, cacheMaxEntries, ttlMs, now = Date.now }: {
  read: PairCheck;
  maxConcurrent: number;
  maxInFlight?: number;
  cacheMaxEntries: number;
  ttlMs: number;
  now?: () => number;
}): PairCheck {
  const cache = createBoundedCache<{ value: boolean | null }>({
    maxEntries: cacheMaxEntries,
    ttlMs,
    maxInFlight,
    now,
    retain: ({ value }) => value !== null,
  });
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

  return async function checkPair(address) {
    const result = await cache.fetch(address.toLowerCase(), async () => ({ value: await limitedRead(address) }));
    return result.status === "saturated" ? null : result.value.value;
  };
}
