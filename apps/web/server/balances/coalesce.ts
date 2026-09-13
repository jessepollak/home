import "server-only";

import type { PortfolioAddress } from "@/config/portfolio-assets";
import type { RegionId } from "@/config/regions";
import type { BalancesSnapshot, Holding } from "@/shared/balances/types";
import { enumerateBalances as defaultEnumerateBalances } from "./enumerate";
import { priceBalances as defaultPriceBalances } from "./price";
import { readBalances as defaultReadBalances } from "./read";
import { resolveBalances as defaultResolveBalances } from "./resolve";
import { assembleBalancesSnapshot } from "./snapshot";
import type {
  BalancesEnumeration,
  BalancesRead,
  BalancesUniverse,
} from "./types";
import { getBalancesUniverse } from "./universe";

export const BALANCES_READ_TTL_MS = 2_000;
export const BALANCES_OWNER_CACHE_MAX = 256;

type Dependencies = {
  readUniverse?: () => Promise<BalancesUniverse>;
  enumerateBalances?: (
    owner: PortfolioAddress,
    signal?: AbortSignal,
  ) => Promise<BalancesEnumeration>;
  readBalances?: (
    universe: BalancesUniverse,
    owner: PortfolioAddress,
    signal?: AbortSignal,
  ) => Promise<BalancesRead>;
  resolveBalances?: (
    read: BalancesRead,
    enumeration: BalancesEnumeration,
  ) => Promise<BalancesRead>;
  priceBalances?: (read: BalancesRead, region: RegionId) => Promise<Holding[]>;
  now?: () => Date;
  ttlMs?: number;
  maxOwners?: number;
};

type Entry = {
  inFlight: Promise<BalancesRead> | null;
  value: BalancesRead | null;
  storedAt: number;
};

/** The 2s pinned registry read cache is separate from the 60s enumeration cache. */
export function createBalancesService(dependencies: Dependencies = {}) {
  const readUniverse = dependencies.readUniverse ?? getBalancesUniverse;
  const enumerateBalances = dependencies.enumerateBalances ??
    defaultEnumerateBalances;
  const readBalances = dependencies.readBalances ?? defaultReadBalances;
  const resolveBalances = dependencies.resolveBalances ?? defaultResolveBalances;
  const priceBalances = dependencies.priceBalances ?? defaultPriceBalances;
  const now = dependencies.now ?? (() => new Date());
  const ttlMs = dependencies.ttlMs ?? BALANCES_READ_TTL_MS;
  const maxOwners = dependencies.maxOwners ?? BALANCES_OWNER_CACHE_MAX;
  const entries = new Map<string, Entry>();

  async function getRead(owner: PortfolioAddress): Promise<BalancesRead> {
    const key = owner.toLowerCase();
    const current = now().getTime();
    let entry = entries.get(key);

    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      if (entry.value && current - entry.storedAt <= ttlMs) {
        return entry.value;
      }
      if (entry.inFlight) return entry.inFlight;
    } else {
      entry = { inFlight: null, value: null, storedAt: 0 };
      entries.set(key, entry);
      evict(entries, maxOwners);
    }

    const target = entry;
    target.inFlight = (async () => {
      const universe = await readUniverse();
      return readBalances(universe, owner);
    })();

    try {
      const value = await target.inFlight;
      target.value = value;
      target.storedAt = now().getTime();
      return value;
    } catch (error) {
      entries.delete(key);
      throw error;
    } finally {
      target.inFlight = null;
    }
  }

  return async function getBalancesSnapshot(
    owner: PortfolioAddress,
    region: RegionId,
    signal?: AbortSignal,
  ): Promise<BalancesSnapshot> {
    void signal;
    const [registryRead, enumeration] = await Promise.all([
      getRead(owner),
      enumerateBalances(owner),
    ]);
    const read = await resolveBalances(registryRead, enumeration);
    const holdings = await priceBalances(read, region);
    return assembleBalancesSnapshot({
      owner,
      region,
      read,
      holdings,
      now,
    });
  };
}

export const getBalancesSnapshot = createBalancesService();

function evict(entries: Map<string, Entry>, maximum: number): void {
  while (entries.size > maximum) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return;
    entries.delete(oldest);
  }
}
