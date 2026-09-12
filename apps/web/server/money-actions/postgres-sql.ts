import "server-only";

import { Pool, type PoolClient } from "@neondatabase/serverless";

export const MONEY_ACTION_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS money_action_operations (
  id TEXT PRIMARY KEY,
  review_hash TEXT NOT NULL,
  subject TEXT NOT NULL,
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
  account_provider TEXT NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  submission_id TEXT,
  transaction_hash TEXT,
  user_operation_hash TEXT,
  verified_execution_key TEXT,
  abandoned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS money_action_owner_recent
  ON money_action_operations (subject, address, chain_id, account_provider, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_verified_execution
  ON money_action_operations (verified_execution_key)
  WHERE verified_execution_key IS NOT NULL;

ALTER TABLE money_action_operations ADD COLUMN IF NOT EXISTS abandoned_at TEXT;
`

export const moneyActionSchemaStatements = MONEY_ACTION_SCHEMA_SQL
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

export const moneyActionQueries = {
  selectById: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations WHERE id = $1
  `.trim(),
  selectByIdForUpdate: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations WHERE id = $1 FOR UPDATE
  `.trim(),
  selectOwned: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations
    WHERE id = $1 AND subject = $2 AND address = $3 AND chain_id = $4 AND account_provider = $5
  `.trim(),
  selectOwnedForUpdate: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations
    WHERE id = $1 AND subject = $2 AND address = $3 AND chain_id = $4 AND account_provider = $5
    FOR UPDATE
  `.trim(),
  insert: `
    INSERT INTO money_action_operations (
      id, review_hash, subject, address, chain_id, account_provider,
      action_json, status, attempt_count, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'prepared', 0, $8, $9)
  `.trim(),
  expire: `
    UPDATE money_action_operations SET status = 'expired', updated_at = $1 WHERE id = $2
  `.trim(),
  dispatch: `
    UPDATE money_action_operations
    SET status = 'submitting', attempt_count = attempt_count + 1,
        claimed_at = COALESCE(claimed_at, $1), updated_at = $2
    WHERE id = $3 AND status = 'prepared'
  `.trim(),
  listOwned: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations
    WHERE subject = $1 AND address = $2 AND chain_id = $3 AND account_provider = $4
    ORDER BY updated_at DESC
    LIMIT $5
  `.trim(),
  listOwnedUnresolvedSends: `
    SELECT action_json, status, attempt_count, claimed_at, submission_id, transaction_hash,
           user_operation_hash, verified_execution_key, abandoned_at, created_at, updated_at
    FROM money_action_operations
    WHERE subject = $1 AND address = $2 AND chain_id = $3 AND account_provider = $4
      AND status IN ('submitting', 'submitted', 'included', 'unknown')
      AND abandoned_at IS NULL
      AND action_json::jsonb ->> 'kind' = 'send'
    ORDER BY updated_at DESC
    LIMIT $5
  `.trim(),
  recordSubmission: `
    UPDATE money_action_operations
    SET status = CASE
          WHEN status IN ('submitting', 'submitted', 'unknown') THEN 'submitted'
          ELSE status
        END,
        submission_id = COALESCE(submission_id, $1),
        transaction_hash = COALESCE(transaction_hash, $2),
        user_operation_hash = COALESCE(user_operation_hash, $3),
        updated_at = $4
    WHERE id = $5 AND subject = $6 AND address = $7 AND chain_id = $8 AND account_provider = $9
  `.trim(),
  pendingReference: `
    SELECT id FROM money_action_operations
    WHERE id <> $1 AND subject = $2 AND address = $3 AND chain_id = $4 AND account_provider = $5 AND (
      ($6::text IS NOT NULL AND submission_id = $6) OR
      ($7::text IS NOT NULL AND LOWER(user_operation_hash) = LOWER($7))
    ) LIMIT 1
  `.trim(),
  verifiedExecutionOther: `
    SELECT id FROM money_action_operations
    WHERE id <> $1 AND verified_execution_key = $2
    LIMIT 1
  `.trim(),
  updateStatus: `
    UPDATE money_action_operations
    SET status = $1, updated_at = $2, verified_execution_key = COALESCE(verified_execution_key, $3)
    WHERE id = $4 AND subject = $5 AND address = $6 AND chain_id = $7 AND account_provider = $8
      AND status = $9
  `.trim(),
  releaseAdmission: `
    UPDATE money_action_operations
    SET abandoned_at = COALESCE(abandoned_at, $1), updated_at = $2
    WHERE id = $3 AND subject = $4 AND address = $5 AND chain_id = $6 AND account_provider = $7
      AND status IN ('submitting', 'submitted', 'included', 'unknown')
  `.trim(),
} as const;

export type OperationRow = {
  action_json: string;
  status: string;
  attempt_count: number;
  claimed_at: string | null;
  submission_id: string | null;
  transaction_hash: string | null;
  user_operation_hash: string | null;
  verified_execution_key: string | null;
  abandoned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SqlQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
};

export type SqlQueryOptions = {
  signal?: AbortSignal;
  /** Server-enforced statement timeout; used only by bounded read paths. */
  timeoutMs?: number;
};

export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
    options?: SqlQueryOptions,
  ): Promise<SqlQueryResult<T>>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  dispose?(): Promise<void>;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; errno?: unknown; sqlState?: unknown };
  return value.code === "23505" || value.errno === "23505" || value.sqlState === "23505";
}

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
};

function wrapQueryable(queryable: Queryable, beginTransaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => Promise<unknown>): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ) {
      throwIfSqlAborted(options.signal);
      const result = await queryable.query(text, values);
      throwIfSqlAborted(options.signal);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
    transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      return beginTransaction(fn as (tx: SqlExecutor) => Promise<unknown>) as Promise<T>;
    },
  };
}

export function createNeonSqlExecutor(
  connectionString: string,
  options: Readonly<{ schema?: string }> = {},
): SqlExecutor {
  let pool: Pool | undefined;
  let disposed = false;
  const schemaName = options.schema === undefined ? null : options.schema;
  const schema = schemaName === null ? null : postgresIdentifier(schemaName);
  const getPool = () => {
    if (disposed) throw new Error("PostgreSQL money-action executor is disposed");
    pool ??= new Pool({ connectionString });
    return pool;
  };

  const beginTransaction = async <Result>(
    fn: (tx: SqlExecutor) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> => {
    throwIfSqlAborted(signal);
    const client: PoolClient = await getPool().connect();
    const tx = wrapQueryable(client, () => {
      throw new Error("nested money-action transactions are not supported");
    });
    try {
      throwIfSqlAborted(signal);
      await client.query("BEGIN");
      if (schema && schemaName) {
        const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
        if (existing.rows.length !== 1) throw new Error(`PostgreSQL schema ${schemaName} does not exist`);
        await client.query(`SET LOCAL search_path TO ${schema}`);
      }
      const result = await fn(tx);
      throwIfSqlAborted(signal);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* keep the original error */ }
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ) {
      return beginTransaction(
        async (tx) => {
          const timeoutMs = boundedSqlTimeoutMs(options.timeoutMs);
          if (timeoutMs !== null) {
            await tx.query(
              "SELECT set_config('statement_timeout', $1, true)",
              [`${timeoutMs}ms`],
              { signal: options.signal },
            );
          }
          return tx.query<T>(text, values, options);
        },
        options.signal,
      );
    },
    transaction: (fn) => beginTransaction(fn),
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (pool) await pool.end();
    },
  };
}

function throwIfSqlAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("PostgreSQL query aborted.", "AbortError");
  }
}

function boundedSqlTimeoutMs(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 5_000) {
    throw new Error("PostgreSQL query timeout must be between 1 and 5000 milliseconds");
  }
  return value;
}

function postgresIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("unsafe PostgreSQL schema identifier");
  return `"${value}"`;
}

export const MONEY_ACTION_EVIDENCE_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_owner_submission_id
  ON money_action_operations (subject, address, chain_id, account_provider, submission_id)
  WHERE submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS money_action_unique_owner_user_operation_hash
  ON money_action_operations (subject, address, chain_id, account_provider, LOWER(user_operation_hash))
  WHERE user_operation_hash IS NOT NULL;
`;

export const moneyActionEvidenceIndexStatements = MONEY_ACTION_EVIDENCE_INDEX_SQL
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);

/**
 * Duplicate owner-scoped provider handles block the unique evidence indexes.
 * The message carries only the index name, handle kind, and group counts — never
 * action IDs, owners, or handle values — so operators may print it verbatim.
 */
export class MoneyActionSchemaPreflightError extends Error {
  constructor(indexName: string, counts: ReadonlyArray<{ action_id_count: number; kind: string }>) {
    super(`money-action schema preflight failed for ${indexName}: duplicate groups ${JSON.stringify(counts)}`);
    this.name = "MoneyActionSchemaPreflightError";
  }
}

const evidenceIndexPreflights = [
  {
    indexName: "money_action_unique_owner_submission_id",
    kind: "submission_id",
    query: `
      SELECT COUNT(*) AS action_id_count
      FROM money_action_operations
      WHERE submission_id IS NOT NULL
      GROUP BY subject, address, chain_id, account_provider, submission_id
      HAVING COUNT(*) > 1
      LIMIT 10
    `.trim(),
  },
  {
    indexName: "money_action_unique_owner_user_operation_hash",
    kind: "user_operation_hash",
    query: `
      SELECT COUNT(*) AS action_id_count
      FROM money_action_operations
      WHERE user_operation_hash IS NOT NULL
      GROUP BY subject, address, chain_id, account_provider, LOWER(user_operation_hash)
      HAVING COUNT(*) > 1
      LIMIT 10
    `.trim(),
  },
] as const;

export async function applyMoneyActionPostgresSchema(executor: SqlExecutor): Promise<void> {
  await executor.transaction(async (transaction) => {
    await transaction.query("SET LOCAL lock_timeout = '5s'");
    await transaction.query("SET LOCAL statement_timeout = '60s'");
    await transaction.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      ["home_money_action_schema_v2"],
    );
    for (const statement of moneyActionSchemaStatements) {
      await transaction.query(statement);
    }
    for (const preflight of evidenceIndexPreflights) {
      const duplicates = await transaction.query<{ action_id_count: number | string }>(preflight.query);
      if (duplicates.rows.length > 0) {
        const counts = duplicates.rows.slice(0, 10).map((row) => ({
          action_id_count: Number(row.action_id_count),
          kind: preflight.kind,
        }));
        throw new MoneyActionSchemaPreflightError(preflight.indexName, counts);
      }
    }
    for (const statement of moneyActionEvidenceIndexStatements) {
      await transaction.query(statement);
    }
  });
}

// Test-only SQL compatibility export; real money-store acceptance runs against PostgreSQL.
export { createFakePostgresExecutor } from "./postgres-sql-test-double";
