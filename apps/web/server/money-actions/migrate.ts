import "server-only";

import { PostgresMoneyActionStore } from "./postgres-store";
import { createNeonSqlExecutor, MONEY_ACTION_DATA_MIGRATION_ID } from "./postgres-sql";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required to migrate money-action tables.");
  process.exit(1);
}

const executor = createNeonSqlExecutor(url);
const startedAt = performance.now();
try {
  const result = await new PostgresMoneyActionStore(executor).ensureReady();
  console.log(
    `money-action data migration migration_id=${result.migrationId} status=${result.disposition} ` +
      `elapsed_ms=${Math.round(performance.now() - startedAt)} aggregate_count=${result.aggregateCount}`,
  );
} catch {
  console.error(
    `money-action data migration migration_id=${MONEY_ACTION_DATA_MIGRATION_ID} status=failed ` +
      `elapsed_ms=${Math.round(performance.now() - startedAt)} aggregate_count=unavailable`,
  );
  process.exitCode = 1;
} finally {
  await executor.dispose?.();
}
