import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MONEY_ACTION_ATTEMPT_SCHEMA_SQL, MONEY_ACTION_SCHEMA_SQL } from "./postgres-sql";

test("embedded Postgres schemas match the operator migration files", () => {
  const cases = [
    ["001_money_action_operations.sql", MONEY_ACTION_SCHEMA_SQL],
    ["002_money_action_attempts.sql", MONEY_ACTION_ATTEMPT_SCHEMA_SQL],
  ] as const;
  for (const [filename, embedded] of cases) {
    const file = readFileSync(resolve(import.meta.dir, "migrations", filename), "utf8");
    const sqlFromFile = file.replace(/^--.*$/gm, "").trim();
    expect(sqlFromFile).toBe(embedded.trim());
  }
});
