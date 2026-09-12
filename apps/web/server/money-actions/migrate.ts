import "server-only";

import { PostgresMoneyActionStore } from "./postgres-store";
import { createNeonSqlExecutor } from "./postgres-sql";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required to migrate money-action tables.");
  process.exit(1);
}

const executor = createNeonSqlExecutor(url);
const startedAt = performance.now();
try {
  await new PostgresMoneyActionStore(executor).ensureSchema();
  console.log(`money-action schema status=applied elapsed_ms=${Math.round(performance.now() - startedAt)}`);
} catch {
  console.error(`money-action schema status=failed elapsed_ms=${Math.round(performance.now() - startedAt)}`);
  process.exitCode = 1;
} finally {
  await executor.dispose?.();
}
