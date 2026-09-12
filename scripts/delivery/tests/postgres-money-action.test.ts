import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MoneyActionOwner, PreparedMoneyAction } from "../../../apps/web/shared/money-actions/types";
import { PostgresMoneyActionStore } from "../../../apps/web/server/money-actions/postgres-store";
import {
  applyMoneyActionPostgresSchema,
  isUniqueViolation,
  moneyActionQueries,
  moneyActionSchemaStatements,
  type SqlExecutor,
} from "../../../apps/web/server/money-actions/postgres-sql";
import { describeMoneyActionStore } from "../../../apps/web/server/money-actions/store-contract";
import { createBunPostgresExecutor } from "../bun-postgres-executor";

const databaseUrl = process.env.MONEY_ACTION_PG_TEST_URL?.trim();
const POSTGRES_CLEANUP_TIMEOUT_SECONDS = 2;
const POSTGRES_CLEANUP_TIMEOUT_MS = POSTGRES_CLEANUP_TIMEOUT_SECONDS * 1_000;
const POSTGRES_FIXTURE_SCHEMA_COUNT = 22;
const POSTGRES_FIXTURE_POOL_COUNT = 2;
const POSTGRES_CLEANUP_SCHEDULING_MARGIN_MS = 5_000;
// Keep the schema count aligned with createSchema call sites: 22×2s drops + 2×2s closes + 5s margin = 53s.
const POSTGRES_AFTER_ALL_TIMEOUT_MS =
  (POSTGRES_FIXTURE_SCHEMA_COUNT + POSTGRES_FIXTURE_POOL_COUNT) * POSTGRES_CLEANUP_TIMEOUT_MS
  + POSTGRES_CLEANUP_SCHEDULING_MARGIN_MS;

if (!databaseUrl) {
  test.skip("real PostgreSQL store contract requires MONEY_ACTION_PG_TEST_URL", () => {});
} else {
  describe("real PostgreSQL money action contract", () => {
    const admin = new Bun.SQL(databaseUrl);
    const sharedPool = new Bun.SQL(databaseUrl);
    const schemas: string[] = [];
    let fixtureNumber = 0;

    function schemaName(label: string): string {
      fixtureNumber += 1;
      return `delivery_${label}_${process.pid}_${fixtureNumber}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    }

    async function createSchema(label: string): Promise<string> {
      const schema = schemaName(label);
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      schemas.push(schema);
      return schema;
    }

    function executor(schema: string): SqlExecutor {
      return createBunPostgresExecutor(sharedPool, schema);
    }

    describeMoneyActionStore("PostgresMoneyActionStore (PostgreSQL 14)", async () => {
      const schema = await createSchema("contract");
      return new PostgresMoneyActionStore(executor(schema));
    });

    test("concurrent same user-operation hash writes have exactly one winner", async () => {
      const schema = await createSchema("user_op_race");
      const owner = ownerFor(101, "cdp-embedded");
      const first = actionFor(101, owner);
      const second = actionFor(102, owner);
      const firstStore = new PostgresMoneyActionStore(executor(schema));
      const secondStore = new PostgresMoneyActionStore(executor(schema));
      await issueAndClaim(firstStore, first);
      await issueAndClaim(secondStore, second);
      const userOperationHash = `0x${"a".repeat(64)}` as const;
      const [firstResult, secondResult] = await Promise.all([
        firstStore.recordSubmission(owner, first.id, {
          userOperationHash,
          transactionHash: `0x${"1".repeat(64)}`,
        }, "2026-09-12T16:00:02.000Z"),
        secondStore.recordSubmission(owner, second.id, {
          userOperationHash,
          transactionHash: `0x${"2".repeat(64)}`,
        }, "2026-09-12T16:00:02.000Z"),
      ]);
      expect(Number(firstResult !== null) + Number(secondResult !== null)).toBe(1);
      const rows = await Promise.all([firstStore.get(owner, first.id), secondStore.get(owner, second.id)]);
      expect(rows.filter((row) => row?.userOperationHash === userOperationHash)).toHaveLength(1);
      expect(rows.filter((row) => row?.status === "submitting" && !row.userOperationHash && !row.transactionHash)).toHaveLength(1);
    });

    test("concurrent same Base submission ID writes have exactly one winner", async () => {
      const schema = await createSchema("submission_race");
      const owner = ownerFor(103, "base-account");
      const first = actionFor(103, owner);
      const second = actionFor(104, owner);
      const firstStore = new PostgresMoneyActionStore(executor(schema));
      const secondStore = new PostgresMoneyActionStore(executor(schema));
      await issueAndClaim(firstStore, first);
      await issueAndClaim(secondStore, second);
      const submissionId = "CallBundle-AbC123";
      const [firstResult, secondResult] = await Promise.all([
        firstStore.recordSubmission(owner, first.id, {
          submissionId,
          transactionHash: `0x${"3".repeat(64)}`,
        }, "2026-09-12T16:00:02.000Z"),
        secondStore.recordSubmission(owner, second.id, {
          submissionId,
          transactionHash: `0x${"4".repeat(64)}`,
        }, "2026-09-12T16:00:02.000Z"),
      ]);
      expect(Number(firstResult !== null) + Number(secondResult !== null)).toBe(1);
      const rows = await Promise.all([firstStore.get(owner, first.id), secondStore.get(owner, second.id)]);
      expect(rows.filter((row) => row?.submissionId === submissionId)).toHaveLength(1);
      expect(rows.filter((row) => row?.status === "submitting" && !row.submissionId && !row.transactionHash)).toHaveLength(1);
    });

    test("pre-004 mixed-case duplicates fail preflight without indexes or row mutation", async () => {
      const schema = await createSchema("preflight");
      const raw = executor(schema);
      await applyStatements(raw, moneyActionSchemaStatements);
      const owner = ownerFor(105, "cdp-embedded");
      const first = actionFor(105, owner);
      const second = actionFor(106, owner);
      await insertRawOperation(raw, first, `0x${"A".repeat(64)}`);
      await insertRawOperation(raw, second, `0x${"a".repeat(64)}`);
      const before = await raw.query(
        "SELECT id, user_operation_hash FROM money_action_operations ORDER BY id",
      );

      let failure: unknown;
      try {
        await applyMoneyActionPostgresSchema(raw);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain("money_action_unique_owner_user_operation_hash");
      expect(message).toContain('"action_id_count":2');
      expect(message).toContain('"kind":"user_operation_hash"');
      expect(message).not.toContain(first.id);
      expect(message).not.toContain(`0x${"A".repeat(64)}`);
      expect(await raw.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE 'money_action_unique_owner_%'",
      )).toMatchObject({ rows: [] });
      expect(await raw.query(
        "SELECT id, user_operation_hash FROM money_action_operations ORDER BY id",
      )).toEqual(before);
    });

    test("post-004 raw case-variant update fails the expression unique index", async () => {
      const schema = await createSchema("raw_update");
      const raw = executor(schema);
      await applyMoneyActionPostgresSchema(raw);
      const owner = ownerFor(107, "cdp-embedded");
      const first = actionFor(107, owner);
      const second = actionFor(108, owner);
      await insertRawOperation(raw, first, `0x${"b".repeat(64)}`);
      await insertRawOperation(raw, second);

      let failure: unknown;
      try {
        await raw.query(
          "UPDATE money_action_operations SET user_operation_hash = $1 WHERE id = $2",
          [`0x${"B".repeat(64)}`, second.id],
        );
      } catch (error) {
        failure = error;
      }
      expect(isUniqueViolation(failure)).toBe(true);
      expect(await raw.query<{ user_operation_hash: string | null }>(
        "SELECT user_operation_hash FROM money_action_operations WHERE id = $1",
        [second.id],
      )).toMatchObject({ rows: [{ user_operation_hash: null }] });
    });

    test("pg_indexes exposes both owner-scoped evidence indexes", async () => {
      const schema = await createSchema("indexes");
      const raw = executor(schema);
      await applyMoneyActionPostgresSchema(raw);
      const result = await raw.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, LOWER(indexdef) AS indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'money_action_unique_owner_submission_id',
            'money_action_unique_owner_user_operation_hash'
          )
        ORDER BY indexname
      `.trim());
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.indexdef).toContain("(subject, address, chain_id, account_provider, submission_id)");
      expect(result.rows[1]?.indexdef).toContain("lower(user_operation_hash)");
    });

    test("schema apply leaves historical 002/003 tables and their rows untouched", async () => {
      const schema = await createSchema("historical_tables");
      const raw = executor(schema);
      await applyStatements(raw, moneyActionSchemaStatements);
      await applySqlFile(raw, "002_money_action_attempts.sql");
      await applySqlFile(raw, "003_money_action_data_migrations.sql");
      const owner = ownerFor(109, "cdp-embedded");
      const action = actionFor(109, owner);
      await insertRawOperation(raw, action);
      await raw.query(
        "INSERT INTO money_action_attempt_states (action_id, state_json, updated_at) VALUES ($1, $2, $3)",
        [action.id, '{"historical":true}', "2026-09-12T16:00:00.000Z"],
      );
      await raw.query(
        "INSERT INTO money_action_attempt_evidence (evidence_key, action_id) VALUES ($1, $2)",
        ["historical-evidence", action.id],
      );
      await raw.query(
        "INSERT INTO money_action_data_migrations (migration_id) VALUES ($1)",
        ["historical-marker"],
      );

      await applyMoneyActionPostgresSchema(raw);
      expect(await raw.query("SELECT action_id, state_json FROM money_action_attempt_states")).toMatchObject({
        rows: [{ action_id: action.id, state_json: '{"historical":true}' }],
      });
      expect(await raw.query("SELECT evidence_key, action_id FROM money_action_attempt_evidence")).toMatchObject({
        rows: [{ evidence_key: "historical-evidence", action_id: action.id }],
      });
      expect(await raw.query("SELECT migration_id FROM money_action_data_migrations")).toMatchObject({
        rows: [{ migration_id: "historical-marker" }],
      });
    });

    afterAll(async () => {
      const errors: unknown[] = [];
      try {
        await sharedPool.close({ timeout: POSTGRES_CLEANUP_TIMEOUT_SECONDS });
      } catch (error) {
        errors.push(error);
      }
      for (const schema of schemas) {
        try {
          await admin.begin(async (transaction) => {
            await transaction.unsafe(`SET LOCAL lock_timeout = '${POSTGRES_CLEANUP_TIMEOUT_SECONDS}s'`);
            await transaction.unsafe(`SET LOCAL statement_timeout = '${POSTGRES_CLEANUP_TIMEOUT_SECONDS}s'`);
            await transaction.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
          });
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await admin.close({ timeout: POSTGRES_CLEANUP_TIMEOUT_SECONDS });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw new AggregateError(errors, "PostgreSQL fixture cleanup failed");
    }, POSTGRES_AFTER_ALL_TIMEOUT_MS);
  });
}

function ownerFor(number: number, accountProvider: MoneyActionOwner["accountProvider"]): MoneyActionOwner {
  return {
    subject: `postgres-owner-${number}`,
    address: `0x${String((number % 8) + 1).repeat(40)}` as `0x${string}`,
    chainId: 8453,
    accountProvider,
  };
}

function actionFor(number: number, owner: MoneyActionOwner): PreparedMoneyAction {
  return {
    id: `b0000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    reviewHash: String.fromCharCode(97 + (number % 6)).repeat(64),
    owner,
    kind: "send",
    title: "Send USDC",
    calls: [{ to: "0x9999999999999999999999999999999999999999", data: "0x", value: "0" }],
    amounts: [],
    warnings: [],
    createdAt: "2026-09-12T16:00:00.000Z",
    expiresAt: "2026-09-12T16:10:00.000Z",
  };
}

async function issueAndClaim(store: PostgresMoneyActionStore, action: PreparedMoneyAction): Promise<void> {
  await store.issue(action);
  const claim = await store.claim(action.owner, action.id, action.reviewHash, "2026-09-12T16:00:01.000Z");
  if (claim?.disposition !== "dispatch") throw new Error("fixture did not dispatch");
}

async function insertRawOperation(
  executor: SqlExecutor,
  action: PreparedMoneyAction,
  userOperationHash?: `0x${string}`,
): Promise<void> {
  await executor.query(moneyActionQueries.insert, [
    action.id,
    action.reviewHash,
    action.owner.subject,
    action.owner.address.toLowerCase(),
    action.owner.chainId,
    action.owner.accountProvider,
    JSON.stringify(action),
    action.createdAt,
    action.createdAt,
  ]);
  if (userOperationHash) {
    await executor.query(
      "UPDATE money_action_operations SET status = 'submitted', attempt_count = 1, claimed_at = $1, user_operation_hash = $2 WHERE id = $3",
      ["2026-09-12T16:00:01.000Z", userOperationHash, action.id],
    );
  }
}

async function applyStatements(executor: SqlExecutor, statements: readonly string[]): Promise<void> {
  await executor.transaction(async (transaction) => {
    for (const statement of statements) await transaction.query(statement);
  });
}

async function applySqlFile(executor: SqlExecutor, filename: string): Promise<void> {
  const sql = readFileSync(resolve(import.meta.dir, "../../../apps/web/server/money-actions/migrations", filename), "utf8");
  const statements = sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await applyStatements(executor, statements);
}
