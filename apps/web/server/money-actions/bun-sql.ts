import "server-only";

import {
  boundedSqlTimeoutMs,
  postgresIdentifier,
  throwIfSqlAborted,
  type SqlExecutor,
  type SqlQueryOptions,
  type SqlQueryResult,
} from "./postgres-sql";

// Minimal structural shape of Bun.SQL so the executor stays testable and does
// not force the hosted Neon graph to import Bun-specific globals.
export type BunSqlClient = {
  unsafe: (text: string, values?: unknown[]) => Promise<ArrayLike<unknown> & { count?: number }>;
  begin: <T>(callback: (transaction: BunSqlClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// Local `bun run db:up` Postgres speaks plain TCP, which the Neon serverless
// driver cannot reach. Only exact loopback hostnames switch to Bun's native SQL
// client; suffix/trick hosts (localhost.example.com, 127.0.0.1.attacker, ...)
// and every other URL keep the hosted Neon path untouched.
export function isLoopbackPostgresUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

export function createBunSqlExecutor(
  client: BunSqlClient,
  options: Readonly<{ schema?: string; inTransaction?: boolean }> = {},
): SqlExecutor {
  const inTransaction = options.inTransaction ?? false;
  const schema = options.schema === undefined ? null : postgresIdentifier(options.schema);
  const schemaName = options.schema;
  let disposed = false;

  // Mirror the Neon executor's cooperative abort contract: check the signal
  // before and after the raw query and surface AbortError without swallowing
  // the query's own outcome.
  const runQuery = async <Row = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
    options: SqlQueryOptions = {},
  ): Promise<SqlQueryResult<Row>> => {
    throwIfSqlAborted(options.signal);
    const result = await client.unsafe(text, values);
    throwIfSqlAborted(options.signal);
    const rows = Array.from(result) as Row[];
    return { rows, rowCount: result.count ?? rows.length };
  };

  const applySchema = async (transaction: BunSqlClient): Promise<void> => {
    if (!schema || schemaName === undefined) return;
    const existing = await transaction.unsafe(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [schemaName],
    );
    if (Array.from(existing).length !== 1) {
      throw new Error(`PostgreSQL schema ${schemaName} does not exist`);
    }
    // Bun.SQL pools connections, so a session-level SET would not reliably
    // stick to later queries. Set it transaction-locally exactly like the
    // hosted Neon executor does.
    await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
  };

  // Bun.SQL.begin performs BEGIN/COMMIT and, on a throwing callback, rolls
  // back while preserving the original error — the same primary-error
  // preservation the Neon executor does explicitly.
  const runTransaction = async <T>(
    run: (transaction: SqlExecutor) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (inTransaction) throw new Error("nested money-action transactions are not supported");
    throwIfSqlAborted(signal);
    return client.begin(async (transaction) => {
      throwIfSqlAborted(signal);
      await applySchema(transaction);
      const result = await run(createBunSqlExecutor(transaction, { inTransaction: true }));
      throwIfSqlAborted(signal);
      return result;
    });
  };

  return {
    async query<Row = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ): Promise<SqlQueryResult<Row>> {
      if (inTransaction) {
        return runQuery<Row>(text, values, options);
      }
      return runTransaction(async (transaction) => {
        // Transaction-local statement timeout, configured identically to the
        // Neon executor before the bounded read runs.
        const timeoutMs = boundedSqlTimeoutMs(options.timeoutMs);
        if (timeoutMs !== null) {
          await transaction.query(
            "SELECT set_config('statement_timeout', $1, true)",
            [`${timeoutMs}ms`],
            { signal: options.signal },
          );
        }
        return transaction.query<Row>(text, values, options);
      }, options.signal);
    },
    transaction: (run) => runTransaction(run),
    ...(inTransaction
      ? {}
      : {
          dispose: async () => {
            if (disposed) return;
            disposed = true;
            await client.close();
          },
        }),
  };
}
