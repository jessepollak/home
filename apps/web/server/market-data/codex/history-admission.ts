import "server-only";

import { getCodexTokenLookup, type CodexTokenLookupEntry } from "./token-lookup";
import { getCodexTrendingMemeAdmission } from "./trending";

const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 256;
const MAX_IN_FLIGHT = 8;
type Lookup = (addresses: readonly `0x${string}`[]) => Promise<Map<string, CodexTokenLookupEntry>>;

export function createInvestHistoryAdmission({ trending = getCodexTrendingMemeAdmission, lookup = getCodexTokenLookup, now = Date.now }: {
  trending?: (address: string, chainId: number) => Promise<boolean>;
  lookup?: Lookup;
  now?: () => number;
} = {}) {
  const cache = new Map<string, { value: boolean; storedAt: number }>();
  const inFlight = new Map<string, Promise<boolean>>();
  return async (address: string, chainId: number): Promise<boolean> => {
    if (chainId !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
    const key = address.toLowerCase();
    const current = now();
    for (const [candidate, entry] of cache) if (current - entry.storedAt > CACHE_TTL_MS) cache.delete(candidate);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.value; }
    const pending = inFlight.get(key);
    if (pending) return pending;
    if (inFlight.size >= MAX_IN_FLIGHT) return false;
    const request = (async () => {
      try {
        if (await trending(key, chainId)) return true;
      } catch {
        return (await lookup([key as `0x${string}`]).catch(() => new Map<string, CodexTokenLookupEntry>())).get(key)?.address === key;
      }
      try {
        return (await lookup([key as `0x${string}`])).get(key)?.address === key;
      } catch { return false; }
    })();
    inFlight.set(key, request);
    try {
      const value = await request;
      cache.set(key, { value, storedAt: now() });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      return value;
    } finally { inFlight.delete(key); }
  };
}

export const getInvestHistoryAdmission = createInvestHistoryAdmission();
