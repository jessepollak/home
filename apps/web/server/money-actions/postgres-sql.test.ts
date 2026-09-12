import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresMoneyActionStore } from "./postgres-store";
import {
  createFakePostgresExecutor,
  createNeonSqlExecutor,
  isUniqueViolation,
  MONEY_ACTION_EVIDENCE_INDEX_SQL,
  MONEY_ACTION_SCHEMA_SQL,
  type SqlExecutor,
  type SqlQueryResult,
} from "./postgres-sql";

test("embedded Postgres schemas match the applied operator migration files", () => {
  const cases = [
    ["001_money_action_operations.sql", MONEY_ACTION_SCHEMA_SQL],
    ["004_money_action_evidence_indexes.sql", MONEY_ACTION_EVIDENCE_INDEX_SQL],
  ] as const;
  for (const [filename, embedded] of cases) {
    const file = readFileSync(resolve(import.meta.dir, "migrations", filename), "utf8");
    const sqlFromFile = file.replace(/^--.*$/gm, "").trim();
    const embeddedSql = embedded.replace(/^--.*$/gm, "").trim();
    expect(sqlFromFile).toBe(embeddedSql);
  }
});

test("schema apply installs transaction timeouts before taking the advisory lock", async () => {
  const issued: string[] = [];
  const base = createFakePostgresExecutor();
  const executor = interceptingExecutor(base, async (text, values, run) => {
    issued.push(text);
    return run(text, values);
  });

  await new PostgresMoneyActionStore(executor).ensureSchema();
  expect(issued.slice(0, 3)).toEqual([
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '60s'",
    "SELECT pg_advisory_xact_lock(hashtext($1))",
  ]);
});

test("schema readiness retries a rejected single-flight promise and caches success", async () => {
  const base = createFakePostgresExecutor();
  let schemaStarts = 0;
  let failFirst = true;
  const executor = interceptingExecutor(base, async (text, values, run) => {
    if (text.startsWith("SELECT COUNT(*) AS action_id_count")) {
      schemaStarts += 1;
      if (failFirst) {
        failFirst = false;
        throw new Error("transient schema contention");
      }
    }
    return run(text, values);
  });
  const store = new PostgresMoneyActionStore(executor);

  const outcomes = await Promise.allSettled([store.ensureSchema(), store.ensureSchema()]);
  expect(outcomes).toMatchObject([
    { status: "rejected", reason: { message: "transient schema contention" } },
    { status: "rejected", reason: { message: "transient schema contention" } },
  ]);
  expect(schemaStarts).toBe(1);

  await store.ensureSchema();
  expect(schemaStarts).toBe(3);
  await store.ensureSchema();
  expect(schemaStarts).toBe(3);
});

test("explicit PostgreSQL schemas fail closed when empty", () => {
  expect(() => createNeonSqlExecutor("postgresql://example/home", { schema: "" })).toThrow(
    "unsafe PostgreSQL schema identifier",
  );
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
