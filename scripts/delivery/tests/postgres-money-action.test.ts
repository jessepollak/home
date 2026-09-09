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
    const pools = [] as InstanceType<typeof Bun.SQL>[];
    const schemas = [] as string[];
    let fixtureNumber = 0;

    describeMoneyActionStore("PostgresMoneyActionStore (PostgreSQL 14)", async () => {
      fixtureNumber += 1;
      const schema = `delivery_${process.pid}_${fixtureNumber}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      schemas.push(schema);

      const pool = new Bun.SQL(databaseUrl);
      pools.push(pool);
      return new PostgresMoneyActionStore(createBunPostgresExecutor(pool, schema));
    });

    afterAll(async () => {
      await Promise.all(pools.map((pool) => pool.close()));
      for (const schema of schemas) {
        await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
      await admin.close();
    });
  });
}
