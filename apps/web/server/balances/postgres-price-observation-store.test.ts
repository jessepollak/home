import { afterAll, beforeAll, describe } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SqlExecutor } from "@/server/db/sql";
import { PostgresPriceObservationStore } from "./price-observation-store";
import { priceObservationStoreContract } from "./price-observation-store.contract";

const connectionString = process.env.BALANCES_PG_TEST_URL?.trim();
const describePostgres = connectionString ? describe : describe.skip;
type BunSqlClient = {
  unsafe(text: string, values?: unknown[]): Promise<ArrayLike<unknown>>;
  begin<T>(run: (transaction: BunSqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
let client: BunSqlClient;
let executor: SqlExecutor;

describePostgres("PostgresPriceObservationStore production contract", () => {
  beforeAll(async () => {
    client = new Bun.SQL(connectionString!) as unknown as BunSqlClient;
    const migration = await readFile(
      resolve(import.meta.dir, "../db/migrations/005_balances.sql"),
      "utf8",
    );
    const attemptsMigration = await readFile(
      resolve(import.meta.dir, "../db/migrations/006_valuation_attempts.sql"),
      "utf8",
    );
    await client.unsafe("DROP TABLE IF EXISTS valuation_attempts");
    await client.unsafe("DROP TABLE IF EXISTS price_observations");
    await client.unsafe(migration);
    await client.unsafe(attemptsMigration);
    executor = bunExecutor(client);
  });
  afterAll(async () => {
    await client?.unsafe("DROP TABLE IF EXISTS valuation_attempts");
    await client?.unsafe("DROP TABLE IF EXISTS price_observations");
    await client?.close();
  });

  priceObservationStoreContract({
    name: "Postgres",
    createStore: () => new PostgresPriceObservationStore(executor),
    reset: async () => { await client.unsafe("TRUNCATE price_observations, valuation_attempts"); },
  });
});

function bunExecutor(sqlClient: BunSqlClient, inTransaction = false): SqlExecutor {
  return {
    async query<T>(text: string, values: unknown[] = []) {
      const rows = Array.from(await sqlClient.unsafe(text, values)) as T[];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>) {
      if (inTransaction) throw new Error("nested transaction unsupported");
      return sqlClient.begin((transaction) => run(bunExecutor(transaction, true)));
    },
  };
}
