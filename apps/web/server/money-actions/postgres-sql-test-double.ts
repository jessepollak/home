import {
  moneyActionAttemptSchemaStatements,
  moneyActionQueries,
  moneyActionSchemaStatements,
  type OperationRow,
  type SqlExecutor,
  type SqlQueryResult,
} from "./postgres-sql";

type StoredRow = OperationRow & {
  id: string;
  review_hash: string;
  subject: string;
  address: string;
  chain_id: number;
  account_provider: string;
};

class TestUniqueViolationError extends Error {
  readonly code = "23505";

  constructor() {
    super("test-only unique violation");
    this.name = "TestUniqueViolationError";
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

/**
 * Compatibility-only SQL double for the companion trade-intent test.
 * Issue #245 money-store acceptance must never use this implementation.
 */
export function createFakePostgresExecutor(): SqlExecutor {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The compatibility PostgreSQL SQL double is test-only");
  }
  const rows = new Map<string, StoredRow>();
  let gate = Promise.resolve();

  const run = (text: string, values: unknown[]): SqlQueryResult => {
    if (
      text === "SELECT pg_advisory_xact_lock(hashtext($1))" ||
      moneyActionSchemaStatements.includes(text as typeof moneyActionSchemaStatements[number]) ||
      moneyActionAttemptSchemaStatements.includes(text as typeof moneyActionAttemptSchemaStatements[number])
    ) return { rows: [], rowCount: 0 };

    if (text === moneyActionQueries.normalizeLegacyHashes) return { rows: [], rowCount: 0 };
    if (text === moneyActionQueries.selectLegacyEvidenceForReservation) return { rows: [], rowCount: 0 };

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
        ) return { rows: [], rowCount: 0 };
        return { rows: [publicRow(row)], rowCount: 1 };
      }
      case moneyActionQueries.insert: {
        const id = String(values[0]);
        if (rows.has(id)) throw new TestUniqueViolationError();
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
      case moneyActionQueries.dispatch: {
        const row = rows.get(String(values[2]));
        if (!row || row.status !== "prepared") return { rows: [], rowCount: 0 };
        row.status = "submitting";
        row.attempt_count += 1;
        row.claimed_at ??= String(values[0]);
        row.updated_at = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      default:
        throw new Error(`unsupported compatibility SQL double query: ${text}`);
    }
  };

  const executor: SqlExecutor = {
    async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
      return run(text, values) as SqlQueryResult<Row>;
    },
    async transaction<Result>(runTransaction: (transaction: SqlExecutor) => Promise<Result>) {
      let release!: () => void;
      const previous = gate;
      gate = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await runTransaction(executor);
      } finally {
        release();
      }
    },
  };
  return executor;
}
