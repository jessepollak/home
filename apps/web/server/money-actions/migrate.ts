import { applyMoneyActionPostgresSchema, createNeonSqlExecutor } from "./postgres-sql";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is required to migrate money-action tables.");
  process.exit(1);
}

await applyMoneyActionPostgresSchema(createNeonSqlExecutor(url));
console.log("money_action_operations schema is ready.");
