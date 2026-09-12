import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MoneyActionOwner, PreparedMoneyAction } from "../../../apps/web/shared/money-actions/types";
import { PostgresMoneyActionStore } from "../../../apps/web/server/money-actions/postgres-store";
import {
  applyMoneyActionPostgresSchema,
  isUniqueViolation,
  moneyActionQueries,
  MoneyActionSchemaPreflightError,
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

    test("raw concurrent user-operation updates prove the expression index arbitrates after both prechecks miss", async () => {
      const schema = await createSchema("user_op_race");
      const owner = ownerFor(101, "cdp-embedded");
      const first = actionFor(101, owner);
      const second = actionFor(102, owner);
      const store = new PostgresMoneyActionStore(executor(schema));
      await issueAndClaim(store, first);
      await issueAndClaim(store, second);
      const userOperationHash = `0x${"a".repeat(64)}` as const;

      await proveRawEvidenceIndexRace({
        databaseUrl,
        schema,
        owner,
        actionIds: [first.id, second.id],
        reference: { userOperationHash },
        expectedIndex: "money_action_unique_owner_user_operation_hash",
      });
    });

    test("raw concurrent Base submission updates prove the exact index arbitrates after both prechecks miss", async () => {
      const schema = await createSchema("submission_race");
      const owner = ownerFor(103, "base-account");
      const first = actionFor(103, owner);
      const second = actionFor(104, owner);
      const store = new PostgresMoneyActionStore(executor(schema));
      await issueAndClaim(store, first);
      await issueAndClaim(store, second);
      const submissionId = "CallBundle-AbC123";

      await proveRawEvidenceIndexRace({
        databaseUrl,
        schema,
        owner,
        actionIds: [first.id, second.id],
        reference: { submissionId },
        expectedIndex: "money_action_unique_owner_submission_id",
      });
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
      expect(failure).toBeInstanceOf(MoneyActionSchemaPreflightError);
      expect((failure as Error).name).toBe("MoneyActionSchemaPreflightError");
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

type EvidenceRaceReference =
  | Readonly<{ submissionId: string; userOperationHash?: never }>
  | Readonly<{ submissionId?: never; userOperationHash: `0x${string}` }>;

async function proveRawEvidenceIndexRace(input: Readonly<{
  databaseUrl: string;
  schema: string;
  owner: MoneyActionOwner;
  actionIds: readonly [string, string];
  reference: EvidenceRaceReference;
  expectedIndex: string;
}>): Promise<void> {
  const clients = [new Bun.SQL(input.databaseUrl), new Bun.SQL(input.databaseUrl)] as const;
  const executors = clients.map((client) => createBunPostgresExecutor(client, input.schema));
  const inspection = createBunPostgresExecutor(clients[0], input.schema);
  const before = new Map<string, Record<string, unknown>>();
  for (const actionId of input.actionIds) {
    const result = await inspection.query<Record<string, unknown>>(
      "SELECT * FROM money_action_operations WHERE id = $1",
      [actionId],
    );
    if (!result.rows[0]) throw new Error("race fixture operation was not found");
    before.set(actionId, result.rows[0]);
  }

  const barrier = twoPartyBarrier();
  const prechecked: string[] = [];
  let outcomes: PromiseSettledResult<string>[];
  try {
    outcomes = await Promise.allSettled(input.actionIds.map((actionId, index) =>
      executors[index]!.transaction(async (transaction) => {
        const owned = await transaction.query(
          moneyActionQueries.selectOwnedForUpdate,
          [actionId, ...ownerParameters(input.owner)],
        );
        if (owned.rowCount !== 1 || owned.rows.length !== 1) {
          throw new Error("race fixture did not lock its owned action");
        }
        const pending = await transaction.query(moneyActionQueries.pendingReference, [
          actionId,
          ...ownerParameters(input.owner),
          input.reference.submissionId ?? null,
          input.reference.userOperationHash ?? null,
        ]);
        if (pending.rows.length !== 0) throw new Error("race pre-check unexpectedly found a conflict");
        prechecked.push(actionId);
        await barrier.arriveAndWait();
        const changed = await transaction.query(moneyActionQueries.recordSubmission, [
          input.reference.submissionId ?? null,
          null,
          input.reference.userOperationHash ?? null,
          "2026-09-12T16:00:02.000Z",
          actionId,
          ...ownerParameters(input.owner),
        ]);
        if (changed.rowCount !== 1) throw new Error("race update did not change its owned action");
        return actionId;
      })
    ));
  } finally {
    await Promise.all(clients.map((client) => client.close({ timeout: 1 })));
  }

  expect(prechecked.sort()).toEqual([...input.actionIds].sort());
  const winners = outcomes.filter((outcome): outcome is PromiseFulfilledResult<string> => outcome.status === "fulfilled");
  const losers = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  const failure = losers[0]!.reason;
  expect(postgresSqlState(failure)).toBe("23505");
  expect(postgresErrorIdentity(failure)).toContain(input.expectedIndex);

  const winnerId = winners[0]!.value;
  const loserId = input.actionIds.find((actionId) => actionId !== winnerId)!;
  const afterClient = new Bun.SQL(input.databaseUrl);
  try {
    const afterExecutor = createBunPostgresExecutor(afterClient, input.schema);
    const afterWinner = await afterExecutor.query<Record<string, unknown>>(
      "SELECT * FROM money_action_operations WHERE id = $1",
      [winnerId],
    );
    const afterLoser = await afterExecutor.query<Record<string, unknown>>(
      "SELECT * FROM money_action_operations WHERE id = $1",
      [loserId],
    );
    expect(JSON.stringify(afterLoser.rows[0])).toBe(JSON.stringify(before.get(loserId)));
    if (input.reference.userOperationHash) {
      expect(afterWinner.rows[0]?.user_operation_hash).toBe(input.reference.userOperationHash);
    } else {
      expect(afterWinner.rows[0]?.submission_id).toBe(input.reference.submissionId);
    }
  } finally {
    await afterClient.close({ timeout: 1 });
  }
}

function twoPartyBarrier(): { arriveAndWait(): Promise<void> } {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolveReady) => { release = resolveReady; });
  return {
    async arriveAndWait() {
      arrivals += 1;
      if (arrivals === 2) release();
      await ready;
    },
  };
}

function postgresSqlState(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { errno?: unknown; sqlState?: unknown; code?: unknown };
  for (const candidate of [value.errno, value.sqlState, value.code]) {
    if (candidate === "23505") return candidate;
  }
  return undefined;
}

function postgresErrorIdentity(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as {
    constraint?: unknown;
    constraint_name?: unknown;
    message?: unknown;
  };
  return [value.constraint, value.constraint_name, value.message, String(error)].join(" ");
}

function ownerParameters(owner: MoneyActionOwner): [string, string, number, string] {
  return [owner.subject, owner.address.toLowerCase(), owner.chainId, owner.accountProvider];
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
