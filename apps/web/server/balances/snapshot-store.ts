import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { BalancesCoverage } from "@/shared/balances/types";
import type { ReadHolding } from "./types";
import { emitServerEvent } from "@/server/observability/log";
import { MemoryBalanceSnapshotStore } from "./memory-snapshot-store";

export type BalanceSnapshotRow = {
  chainId: number;
  address: `0x${string}`;
  blockNumber: string;
  blockHash: `0x${string}`;
  blockTimestamp: string;
  observedAt: string;
  staleAt: string | null;
  hotUntil: string | null;
  enumerationCursor: string | null;
  holdings: ReadHolding[];
  coverage: BalancesCoverage;
};

export type BalanceObservation = Omit<
  BalanceSnapshotRow,
  "staleAt" | "hotUntil" | "enumerationCursor"
> & { enumerationCursor?: string | null };

export interface BalanceSnapshotStore {
  get(chainId: number, address: `0x${string}`): Promise<BalanceSnapshotRow | null>;
  putObservation(row: BalanceObservation): Promise<boolean>;
  /** Signals intentionally no-op before the first observation exists. */
  markStale(chainId: number, address: `0x${string}`, at: Date): Promise<void>;
  markStaleMany(chainId: number, addresses: readonly `0x${string}`[], at: Date): Promise<void>;
  /** Signals intentionally no-op before the first observation exists. */
  markHot(chainId: number, address: `0x${string}`, until: Date): Promise<void>;
}

type DatabaseRow = Record<string, unknown>;

export class PostgresBalanceSnapshotStore implements BalanceSnapshotStore {
  constructor(private readonly sql: SqlExecutor) {}

  async get(chainId: number, address: `0x${string}`): Promise<BalanceSnapshotRow | null> {
    const result = await this.sql.query(
      "SELECT * FROM balance_snapshots WHERE chain_id=$1 AND address=$2",
      [chainId, address.toLowerCase()],
    );
    return result.rows[0] ? fromDatabaseRow(result.rows[0] as DatabaseRow) : null;
  }

  async putObservation(row: BalanceObservation): Promise<boolean> {
    const result = await this.sql.query(
      `INSERT INTO balance_snapshots
       (chain_id,address,block_number,block_hash,block_timestamp,observed_at,enumeration_cursor,holdings,coverage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       ON CONFLICT (chain_id,address) DO UPDATE SET
         block_number=EXCLUDED.block_number,
         block_hash=EXCLUDED.block_hash,
         block_timestamp=EXCLUDED.block_timestamp,
         observed_at=EXCLUDED.observed_at,
         enumeration_cursor=EXCLUDED.enumeration_cursor,
         holdings=EXCLUDED.holdings,
         coverage=EXCLUDED.coverage
       WHERE EXCLUDED.block_number >= balance_snapshots.block_number
       RETURNING 1`,
      [row.chainId, row.address.toLowerCase(), row.blockNumber, row.blockHash,
        row.blockTimestamp, row.observedAt, row.enumerationCursor ?? null,
        JSON.stringify(row.holdings), JSON.stringify(row.coverage)],
    );
    return result.rowCount === 1;
  }

  async markStale(chainId: number, address: `0x${string}`, at: Date): Promise<void> {
    await this.markStaleMany(chainId, [address], at);
  }

  async markStaleMany(chainId: number, addresses: readonly `0x${string}`[], at: Date): Promise<void> {
    if (addresses.length === 0) return;
    await this.sql.query(
      "UPDATE balance_snapshots SET stale_at=GREATEST(stale_at,$3) WHERE chain_id=$1 AND address = ANY($2::text[])",
      [chainId, postgresTextArray(addresses), at.toISOString()],
    );
  }

  async markHot(chainId: number, address: `0x${string}`, until: Date): Promise<void> {
    await this.sql.query(
      "UPDATE balance_snapshots SET hot_until=GREATEST(hot_until,$3) WHERE chain_id=$1 AND address=$2",
      [chainId, address.toLowerCase(), until.toISOString()],
    );
  }
}

let runtimeStore: BalanceSnapshotStore | null = null;
export function getBalanceSnapshotStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BalanceSnapshotStore {
  if (runtimeStore) return runtimeStore;
  runtimeStore = env.DATABASE_URL?.trim()
    ? new PostgresBalanceSnapshotStore(getSqlExecutor(env))
    : new MemoryBalanceSnapshotStore();
  if (!env.DATABASE_URL?.trim() && isHostedRuntime(env)) {
    emitServerEvent("balances-store", {
      route: "/api/balances",
      code: "BALANCE_MEMORY_FALLBACK",
      outcome: "unavailable",
      durationMs: 0,
    });
  }
  return runtimeStore;
}

function fromDatabaseRow(row: DatabaseRow): BalanceSnapshotRow {
  return {
    chainId: Number(row.chain_id),
    address: String(row.address).toLowerCase() as `0x${string}`,
    blockNumber: String(row.block_number),
    blockHash: String(row.block_hash).toLowerCase() as `0x${string}`,
    blockTimestamp: String(row.block_timestamp),
    observedAt: timestamp(row.observed_at),
    staleAt: row.stale_at === null ? null : timestamp(row.stale_at),
    hotUntil: row.hot_until === null ? null : timestamp(row.hot_until),
    enumerationCursor: row.enumeration_cursor === null
      ? null
      : String(row.enumeration_cursor),
    holdings: parseJson<ReadHolding[]>(row.holdings),
    coverage: parseJson<BalancesCoverage>(row.coverage),
  };
}

export function isHostedRuntime(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

function postgresTextArray(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.toLowerCase()}"`).join(",")}}`;
}

function timestamp(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? JSON.parse(value) as T : value as T;
}
