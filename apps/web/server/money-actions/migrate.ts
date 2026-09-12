import "server-only";

import { PostgresMoneyActionStore } from "./postgres-store";
import { createNeonSqlExecutor, MoneyActionSchemaPreflightError } from "./postgres-sql";

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
} catch (error) {
  // Only the preflight diagnostic is printed: it is count-only by construction.
  // Every other failure stays redacted to status=failed.
  if (error instanceof MoneyActionSchemaPreflightError) console.error(error.message);
  console.error(`money-action schema status=failed elapsed_ms=${Math.round(performance.now() - startedAt)}`);
  process.exitCode = 1;
} finally {
  await executor.dispose?.();
}
