import "server-only";

import { getSqlExecutor, type SqlExecutor } from "@/server/db/sql";
import type { ExactDecimal } from "@/shared/balances/types";
import { MemoryPriceObservationStore } from "./memory-price-observation-store";

export type PriceObservation = {
  assetKey: string;
  unitPrice: ExactDecimal;
  asOf: string;
  fetchedAt: string;
};

export interface PriceObservationStore {
  getMany(assetKeys: readonly string[]): Promise<PriceObservation[]>;
  /** Upserts by source time; equal source time refreshes fetchedAt, older never wins. */
  putMany(observations: readonly PriceObservation[]): Promise<void>;
}

type DatabaseRow = Record<string, unknown>;

export class PostgresPriceObservationStore implements PriceObservationStore {
  constructor(private readonly sql: SqlExecutor) {}

  async getMany(assetKeys: readonly string[]): Promise<PriceObservation[]> {
    if (assetKeys.length === 0) return [];
    const result = await this.sql.query(
      `SELECT asset_key,unit_price_atoms,unit_price_scale,as_of,fetched_at
       FROM price_observations
       WHERE asset_key = ANY($1::text[])`,
      [postgresTextArray(assetKeys)],
    );
    return result.rows.map((row) => fromDatabaseRow(row as DatabaseRow));
  }

  async putMany(observations: readonly PriceObservation[]): Promise<void> {
    if (observations.length === 0) return;
    const values = observations.flatMap((observation) => [
      observation.assetKey,
      observation.unitPrice.atoms,
      observation.unitPrice.scale,
      observation.asOf,
      observation.fetchedAt,
    ]);
    const rows = observations.map((_, index) => {
      const first = index * 5 + 1;
      return `($${first},$${first + 1},$${first + 2},$${first + 3},$${first + 4})`;
    });
    await this.sql.query(
      `INSERT INTO price_observations
       (asset_key,unit_price_atoms,unit_price_scale,as_of,fetched_at)
       VALUES ${rows.join(",")}
       ON CONFLICT (asset_key) DO UPDATE SET
         unit_price_atoms=EXCLUDED.unit_price_atoms,
         unit_price_scale=EXCLUDED.unit_price_scale,
         as_of=EXCLUDED.as_of,
         fetched_at=EXCLUDED.fetched_at
       WHERE EXCLUDED.as_of > price_observations.as_of
          OR (EXCLUDED.as_of = price_observations.as_of
              AND EXCLUDED.fetched_at > price_observations.fetched_at)`,
      values,
    );
  }
}

let runtimeStore: PriceObservationStore | null = null;

export function getPriceObservationStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PriceObservationStore {
  if (runtimeStore) return runtimeStore;
  runtimeStore = env.DATABASE_URL?.trim()
    ? new PostgresPriceObservationStore(getSqlExecutor(env))
    : new MemoryPriceObservationStore();
  return runtimeStore;
}

function fromDatabaseRow(row: DatabaseRow): PriceObservation {
  return {
    assetKey: String(row.asset_key),
    unitPrice: {
      atoms: String(row.unit_price_atoms),
      scale: Number(row.unit_price_scale),
    },
    asOf: timestamp(row.as_of),
    fetchedAt: timestamp(row.fetched_at),
  };
}

function postgresTextArray(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",")}}`;
}

function timestamp(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
