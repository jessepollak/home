import "server-only";

import type {
  BalanceObservation,
  BalanceSnapshotRow,
  BalanceSnapshotStore,
} from "./snapshot-store";

export class MemoryBalanceSnapshotStore implements BalanceSnapshotStore {
  private readonly rows = new Map<string, BalanceSnapshotRow>();

  async get(chainId: number, address: `0x${string}`): Promise<BalanceSnapshotRow | null> {
    const row = this.rows.get(key(chainId, address));
    return row ? structuredClone(row) : null;
  }

  async putObservation(row: BalanceObservation): Promise<boolean> {
    const rowKey = key(row.chainId, row.address);
    const existing = this.rows.get(rowKey);
    if (existing && BigInt(row.blockNumber) < BigInt(existing.blockNumber)) return false;
    this.rows.set(rowKey, structuredClone({
      ...row,
      address: row.address.toLowerCase() as `0x${string}`,
      staleAt: existing?.staleAt ?? null,
      hotUntil: existing?.hotUntil ?? null,
      enumerationCursor: row.enumerationCursor ?? null,
    }));
    return true;
  }

  async markStale(chainId: number, address: `0x${string}`, at: Date): Promise<void> {
    await this.markStaleMany(chainId, [address], at);
  }

  async markStaleMany(chainId: number, addresses: readonly `0x${string}`[], at: Date): Promise<void> {
    for (const address of addresses) {
      const rowKey = key(chainId, address);
      const existing = this.rows.get(rowKey);
      if (!existing) continue;
      const staleAt = existing.staleAt && Date.parse(existing.staleAt) > at.getTime()
        ? existing.staleAt
        : at.toISOString();
      this.rows.set(rowKey, { ...existing, staleAt });
    }
  }

  async markHot(chainId: number, address: `0x${string}`, until: Date): Promise<void> {
    const rowKey = key(chainId, address);
    const existing = this.rows.get(rowKey);
    if (!existing) return;
    const hotUntil = existing.hotUntil && Date.parse(existing.hotUntil) > until.getTime()
      ? existing.hotUntil
      : until.toISOString();
    this.rows.set(rowKey, { ...existing, hotUntil });
  }

  deleteForTests(chainId: number, address: `0x${string}`): void {
    this.rows.delete(key(chainId, address));
  }
}

function key(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}
