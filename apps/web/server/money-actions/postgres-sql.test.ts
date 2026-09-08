import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MONEY_ACTION_SCHEMA_SQL } from "./postgres-sql";

test("embedded Postgres schema matches the operator migration file", () => {
  const file = readFileSync(
    resolve(import.meta.dir, "migrations/001_money_action_operations.sql"),
    "utf8",
  );
  const sqlFromFile = file.replace(/^--.*$/gm, "").trim();
  expect(sqlFromFile).toBe(MONEY_ACTION_SCHEMA_SQL.trim());
});
