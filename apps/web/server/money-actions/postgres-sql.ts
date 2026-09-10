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
      ($7::text IS NOT NULL AND user_operation_hash = $7)
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

export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlQueryResult<T>>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "23505");
}

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
};

function wrapQueryable(queryable: Queryable, beginTransaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => Promise<unknown>): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
      const result = await queryable.query(text, values);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
    transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      return beginTransaction(fn as (tx: SqlExecutor) => Promise<unknown>) as Promise<T>;
    },
  };
}

export function createNeonSqlExecutor(connectionString: string): SqlExecutor {
  let pool: Pool | undefined;
  const getPool = () => {
    pool ??= new Pool({ connectionString });
    return pool;
  };

  const beginTransaction = async (fn: (tx: SqlExecutor) => Promise<unknown>) => {
    const client: PoolClient = await getPool().connect();
    const tx = wrapQueryable(client, () => {
      throw new Error("nested money-action transactions are not supported");
    });
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* keep the original error */ }
      throw error;
    } finally {
      client.release();
    }
  };

  return wrapQueryable(getPool(), beginTransaction);
}

type StoredRow = OperationRow & {
  id: string;
  review_hash: string;
  subject: string;
  address: string;
  chain_id: number;
  account_provider: string;
};

class UniqueViolationError extends Error {
  readonly code = "23505";
  constructor() {
    super("unique_violation");
    this.name = "UniqueViolationError";
  }
}

function publicRow(row: StoredRow): OperationRow {
  return {
    action_json: row.action_json,
    status: row.status,
    attempt_count: row.attempt_count,
    claimed_at: row.claimed_at,
    submission_id: row.submission_id,
    transaction_hash: row.transaction_hash,
    user_operation_hash: row.user_operation_hash,
    verified_execution_key: row.verified_execution_key,
    abandoned_at: row.abandoned_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createFakePostgresExecutor(): SqlExecutor {
  const rows = new Map<string, StoredRow>();
  let gate = Promise.resolve();

  const run = (text: string, values: unknown[]): SqlQueryResult => {
    if (moneyActionSchemaStatements.includes(text)) {
      return { rows: [], rowCount: 0 };
    }
    switch (text) {
      case moneyActionQueries.selectById:
      case moneyActionQueries.selectByIdForUpdate: {
        const row = rows.get(String(values[0]));
        return { rows: row ? [publicRow(row)] : [], rowCount: row ? 1 : 0 };
      }
      case moneyActionQueries.selectOwned:
      case moneyActionQueries.selectOwnedForUpdate: {
        const row = rows.get(String(values[0]));
        if (
          !row ||
          row.subject !== values[1] ||
          row.address !== values[2] ||
          row.chain_id !== Number(values[3]) ||
          row.account_provider !== values[4]
        ) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [publicRow(row)], rowCount: 1 };
      }
      case moneyActionQueries.insert: {
        const id = String(values[0]);
        if (rows.has(id)) throw new UniqueViolationError();
        rows.set(id, {
          id,
          review_hash: String(values[1]),
          subject: String(values[2]),
          address: String(values[3]),
          chain_id: Number(values[4]),
          account_provider: String(values[5]),
          action_json: String(values[6]),
          status: "prepared",
          attempt_count: 0,
          claimed_at: null,
          submission_id: null,
          transaction_hash: null,
          user_operation_hash: null,
          verified_execution_key: null,
          abandoned_at: null,
          created_at: String(values[7]),
          updated_at: String(values[8]),
        });
        return { rows: [], rowCount: 1 };
      }
      case moneyActionQueries.expire: {
        const row = rows.get(String(values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.status = "expired";
        row.updated_at = String(values[0]);
        return { rows: [], rowCount: 1 };
      }
      case moneyActionQueries.dispatch: {
        const row = rows.get(String(values[2]));
        if (!row || row.status !== "prepared") return { rows: [], rowCount: 0 };
        row.status = "submitting";
        row.attempt_count += 1;
        row.claimed_at ??= String(values[0]);
        row.updated_at = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      case moneyActionQueries.listOwned:
      case moneyActionQueries.listOwnedUnresolvedSends: {
        const unresolvedSendsOnly = text === moneyActionQueries.listOwnedUnresolvedSends;
        const matched = [...rows.values()]
          .filter((row) =>
            row.subject === values[0] &&
            row.address === values[1] &&
            row.chain_id === Number(values[2]) &&
            row.account_provider === values[3]
          )
          .filter((row) => !unresolvedSendsOnly || (
            ["submitting", "submitted", "included", "unknown"].includes(row.status) &&
            !row.abandoned_at &&
            (JSON.parse(row.action_json) as { kind?: unknown }).kind === "send"
          ))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
          .slice(0, Number(values[4]))
          .map(publicRow);
        return { rows: matched, rowCount: matched.length };
      }
      case moneyActionQueries.recordSubmission: {
        const row = rows.get(String(values[4]));
        if (
          !row ||
          row.subject !== values[5] ||
          row.address !== values[6] ||
          row.chain_id !== Number(values[7]) ||
          row.account_provider !== values[8]
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (["submitting", "submitted", "unknown"].includes(row.status)) {
          row.status = "submitted";
        }
        row.submission_id ??= values[0] == null ? null : String(values[0]);
        row.transaction_hash ??= values[1] == null ? null : String(values[1]);
        row.user_operation_hash ??= values[2] == null ? null : String(values[2]);
        row.updated_at = String(values[3]);
        return { rows: [], rowCount: 1 };
      }
      case moneyActionQueries.pendingReference: {
        const found = [...rows.values()].some((row) =>
          row.id !== values[0] &&
          row.subject === values[1] &&
          row.address === values[2] &&
          row.chain_id === Number(values[3]) &&
          row.account_provider === values[4] && (
            (values[5] != null && row.submission_id === values[5]) ||
            (values[6] != null && row.user_operation_hash === values[6])
          )
        );
        return { rows: found ? [{ id: "taken" }] : [], rowCount: found ? 1 : 0 };
      }
      case moneyActionQueries.verifiedExecutionOther: {
        const found = [...rows.values()].some((row) =>
          row.id !== values[0] && row.verified_execution_key === values[1]
        );
        return { rows: found ? [{ id: "taken" }] : [], rowCount: found ? 1 : 0 };
      }
      case moneyActionQueries.updateStatus: {
        const row = rows.get(String(values[3]));
        if (
          !row ||
          row.subject !== values[4] ||
          row.address !== values[5] ||
          row.chain_id !== Number(values[6]) ||
          row.account_provider !== values[7] ||
          row.status !== values[8]
        ) {
          return { rows: [], rowCount: 0 };
        }
        const nextKey = values[2] == null ? null : String(values[2]);
        if (nextKey) {
          const taken = [...rows.values()].some((other) =>
            other.id !== row.id && other.verified_execution_key === nextKey
          );
          if (taken) throw new UniqueViolationError();
        }
        row.status = String(values[0]);
        row.updated_at = String(values[1]);
        row.verified_execution_key ??= nextKey;
        return { rows: [], rowCount: 1 };
      }
      case moneyActionQueries.releaseAdmission: {
        const row = rows.get(String(values[2]));
        if (
          !row ||
          row.subject !== values[3] ||
          row.address !== values[4] ||
          row.chain_id !== Number(values[5]) ||
          row.account_provider !== values[6] ||
          !["submitting", "submitted", "included", "unknown"].includes(row.status)
        ) {
          return { rows: [], rowCount: 0 };
        }
        row.abandoned_at ??= String(values[0]);
        row.updated_at = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      default:
        throw new Error(`unexpected money-action SQL: ${text}`);
    }
  };

  const executor: SqlExecutor = {
    async query<T = Record<string, unknown>>(text: string, values: unknown[] = []) {
      return run(text, values) as SqlQueryResult<T>;
    },
    async transaction(fn) {
      let release!: () => void;
      const previous = gate;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await fn(executor);
      } finally {
        release();
      }
    },
  };
  return executor;
}

export async function applyMoneyActionPostgresSchema(executor: SqlExecutor): Promise<void> {
  for (const statement of moneyActionSchemaStatements) {
    await executor.query(statement);
  }
}
