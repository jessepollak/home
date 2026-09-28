import "server-only";

import { createBoundedCache } from "@/server/cache/bounded";

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
  const cache = createBoundedCache<boolean>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX,
    maxInFlight: MAX_IN_FLIGHT,
    now,
  });
  return async (address: string, chainId: number): Promise<boolean> => {
    if (chainId !== 8453 || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
    const key = address.toLowerCase();
    const result = await cache.fetch(key, async () => {
      try {
        if (await trending(key, chainId)) return true;
      } catch {
        return (await lookup([key as `0x${string}`]).catch(() => new Map<string, CodexTokenLookupEntry>())).get(key)?.address === key;
      }
      try {
        return (await lookup([key as `0x${string}`])).get(key)?.address === key;
      } catch { return false; }
    });
    return result.status === "saturated" ? false : result.value;
  };
}

export const getInvestHistoryAdmission = createInvestHistoryAdmission();
