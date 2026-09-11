import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evidenceUniquenessKey } from "./attempt-store-core";
import { createPostgresAttemptStoreResource, PostgresMoneyActionStore } from "./postgres-store";
import {
  createFakePostgresExecutor,
  createNeonSqlExecutor,
  isUniqueViolation,
  MONEY_ACTION_ATTEMPT_SCHEMA_SQL,
  MONEY_ACTION_DATA_MIGRATION_ID,
  MONEY_ACTION_DATA_MIGRATION_SCHEMA_SQL,
  MONEY_ACTION_SCHEMA_SQL,
  moneyActionQueries,
  type SqlExecutor,
  type SqlQueryResult,
} from "./postgres-sql";

test("embedded Postgres schemas match the operator migration files", () => {
  const cases = [
    ["001_money_action_operations.sql", MONEY_ACTION_SCHEMA_SQL],
    ["002_money_action_attempts.sql", MONEY_ACTION_ATTEMPT_SCHEMA_SQL],
    ["003_money_action_data_migrations.sql", MONEY_ACTION_DATA_MIGRATION_SCHEMA_SQL],
  ] as const;
  for (const [filename, embedded] of cases) {
    const file = readFileSync(resolve(import.meta.dir, "migrations", filename), "utf8");
    const sqlFromFile = file.replace(/^--.*$/gm, "").trim();
    expect(sqlFromFile).toBe(embedded.trim());
  }
  expect(MONEY_ACTION_DATA_MIGRATION_SCHEMA_SQL).not.toContain("INSERT INTO");
  expect(MONEY_ACTION_DATA_MIGRATION_ID).toBe("canonical-evidence-reservations-v1");
});

test("store readiness retries a rejected single-flight promise and caches success", async () => {
  const base = createFakePostgresExecutor();
  let migrationStarts = 0;
  let failFirst = true;
  const executor = interceptingExecutor(base, async (text, values, run) => {
    if (text === moneyActionQueries.selectEffectiveSchema) {
      migrationStarts += 1;
      if (failFirst) {
        failFirst = false;
        throw new Error("transient migration contention");
      }
    }
    return run(text, values);
  });
  const store = new PostgresMoneyActionStore(executor);

  const failedReadiness = Promise.allSettled([store.ensureReady(), store.ensureReady()]);
  const outcomes = await failedReadiness;
  expect(outcomes).toHaveLength(2);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toBeInstanceOf(Error);
      expect((outcome.reason as Error).message).toBe("transient migration contention");
    }
  }
  expect(migrationStarts).toBe(1);

  const retried = await store.ensureReady();
  expect(retried).toMatchObject({ disposition: "applied" });
  expect(migrationStarts).toBe(2);
  expect(await store.ensureReady()).toBe(retried);
  expect(migrationStarts).toBe(2);
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

function interceptingExecutor(
  base: SqlExecutor,
  intercept: (
    text: string,
    values: unknown[],
    run: (text: string, values: unknown[]) => Promise<SqlQueryResult<unknown>>,
  ) => Promise<SqlQueryResult<unknown>>,
): SqlExecutor {
  return {
    async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
      return await intercept(
        text,
        values,
        (query, parameters) => base.query<unknown>(query, parameters),
      ) as SqlQueryResult<Row>;
    },
    transaction<Result>(run: (transaction: SqlExecutor) => Promise<Result>) {
      return base.transaction((transaction) => run(interceptingExecutor(transaction, intercept)));
    },
    ...(base.dispose ? { dispose: () => base.dispose!() } : {}),
  };
}

test("the SQL double remains test-only and absent from runtime/store acceptance", () => {
  const postgresSql = readFileSync(resolve(import.meta.dir, "postgres-sql.ts"), "utf8");
  const moneyStoreTests = readFileSync(resolve(import.meta.dir, "store.test.ts"), "utf8");
  const runtime = readFileSync(resolve(import.meta.dir, "runtime-store.ts"), "utf8");
  const companion = readFileSync(resolve(import.meta.dir, "../trading/runtime-intent-store.test.ts"), "utf8");
  expect(postgresSql).toContain("Test-only SQL compatibility export");
  expect(moneyStoreTests).not.toContain("createFakePostgresExecutor");
  expect(runtime).not.toContain("createFakePostgresExecutor");
  expect(companion).toContain("createFakePostgresExecutor");
});
