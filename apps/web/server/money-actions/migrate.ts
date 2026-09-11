import { PostgresMoneyActionStore } from "./postgres-store";
import { createNeonSqlExecutor } from "./postgres-sql";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required to migrate money-action tables.");
  process.exit(1);
}

const executor = createNeonSqlExecutor(url);
try {
  await new PostgresMoneyActionStore(executor).ensureSchema();
  console.log("money-action operation, attempt, and evidence reservations are ready.");
} finally {
  await executor.dispose?.();
}
