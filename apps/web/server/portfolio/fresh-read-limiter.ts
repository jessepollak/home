import "server-only";

export const PORTFOLIO_FRESH_READ_INTERVAL_MS = 5_000;
export const PORTFOLIO_FRESH_READ_MAX_OWNERS = 1_000;

export function createPortfolioFreshReadLimiter(options: {
  now?: () => number;
  intervalMs?: number;
  maxOwners?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? PORTFOLIO_FRESH_READ_INTERVAL_MS;
  const maxOwners = options.maxOwners ?? PORTFOLIO_FRESH_READ_MAX_OWNERS;
  const lastFreshRead = new Map<string, number>();

  return {
    take(ownerKey: string): boolean {
      const current = now();
      const previous = lastFreshRead.get(ownerKey);
      if (previous !== undefined && current - previous < intervalMs) return false;
      lastFreshRead.delete(ownerKey);
      lastFreshRead.set(ownerKey, current);
      while (lastFreshRead.size > maxOwners) {
        const oldest = lastFreshRead.keys().next().value;
        if (typeof oldest !== "string") break;
        lastFreshRead.delete(oldest);
      }
      return true;
    },
  };
}

export type PortfolioFreshReadLimiter = ReturnType<typeof createPortfolioFreshReadLimiter>;
