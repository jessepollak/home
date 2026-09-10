import { afterAll, describe, test } from "bun:test";
import { PostgresMoneyActionStore } from "../../../apps/web/server/money-actions/postgres-store";
import { describeMoneyActionStore } from "../../../apps/web/server/money-actions/store-contract";
import { createBunPostgresExecutor } from "../bun-postgres-executor";

const databaseUrl = process.env.MONEY_ACTION_PG_TEST_URL?.trim();

if (!databaseUrl) {
  test.skip("real PostgreSQL store contract requires MONEY_ACTION_PG_TEST_URL", () => {});
} else {
  describe("real PostgreSQL money action contract", () => {
    const admin = new Bun.SQL(databaseUrl);
    // Every fixture keeps its own schema; the executor applies SET LOCAL search_path
    // per transaction, so one shared pool is safe even when contract tests overlap.
    const pool = new Bun.SQL(databaseUrl);
    const schemas = [] as string[];
    let fixtureNumber = 0;

    describeMoneyActionStore("PostgresMoneyActionStore (PostgreSQL 14)", async () => {
      fixtureNumber += 1;
      const schema = `delivery_${process.pid}_${fixtureNumber}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      schemas.push(schema);

      return new PostgresMoneyActionStore(createBunPostgresExecutor(pool, schema));
    });

    afterAll(async () => {
      for (const schema of schemas) {
        await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
      await pool.close();
      await admin.close();
    });
  });
}
