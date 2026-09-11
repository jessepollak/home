import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidenceUniquenessKey } from "./attempt-store-core";
import { createPostgresAttemptStoreResource } from "./postgres-store";
import {
  createNeonSqlExecutor,
  isUniqueViolation,
  MONEY_ACTION_ATTEMPT_SCHEMA_SQL,
  MONEY_ACTION_SCHEMA_SQL,
} from "./postgres-sql";

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

test("explicit PostgreSQL schemas fail closed when empty or missing", () => {
  expect(() => createNeonSqlExecutor("postgresql://example/home", { schema: "" })).toThrow(
    "unsafe PostgreSQL schema identifier",
  );
  expect(() => createPostgresAttemptStoreResource({
    backend: "postgres",
    connectionString: "postgresql://example/home",
  } as never)).toThrow("explicit nonempty schema");
});

test("evidence reservation keys are canonical PostgreSQL-safe tuples", () => {
  const key = evidenceUniquenessKey({
    subject: "subject-a",
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
    accountProvider: "cdp-embedded",
  }, {
    kind: "user-operation-hash",
    provider: "cdp-embedded",
    value: `0x${"A".repeat(64)}`,
  });
  expect(key).not.toContain("\u0000");
  expect(JSON.parse(key!)).toEqual([
    "subject-a",
    "0x1111111111111111111111111111111111111111",
    8453,
    "cdp-embedded",
    "cdp-embedded",
    "user-operation-hash",
    `0x${"a".repeat(64)}`,
  ]);
});

test("recognizes node-postgres and Bun.SQL unique-violation shapes", () => {
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation({ code: "ERR_POSTGRES_SERVER_ERROR", errno: "23505" })).toBe(true);
  expect(isUniqueViolation({ sqlState: "23505" })).toBe(true);
  expect(isUniqueViolation({ code: "ERR_POSTGRES_SERVER_ERROR" })).toBe(false);
});

test("the temporary SQL double remains isolated to the companion trading test", () => {
  const postgresSql = readFileSync(resolve(import.meta.dir, "postgres-sql.ts"), "utf8");
  const moneyStoreTests = readFileSync(resolve(import.meta.dir, "store.test.ts"), "utf8");
  const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
  const companion = readFileSync(resolve(import.meta.dir, "../trading/runtime-intent-store.test.ts"), "utf8");
  expect(postgresSql).toContain("Temporary #243 test-only import compatibility");
  expect(moneyStoreTests).not.toContain("createFakePostgresExecutor");
  expect(runtime).not.toContain("createFakePostgresExecutor");
  expect(companion).toContain("createFakePostgresExecutor");
});
