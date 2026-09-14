import "server-only";

import { Pool, type PoolClient } from "pg";

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

type DriverQueryResult = { rows?: unknown[]; rowCount?: number | null };
type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<DriverQueryResult | DriverQueryResult[]>;
};

type PoolClientLike = Queryable & Pick<PoolClient, "release">;

type PoolLike = Queryable & {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): unknown;
};

type PostgresPoolConfig = {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

type PostgresSqlExecutorOptions = Readonly<{
  schema?: string;
  poolFactory?: (config: PostgresPoolConfig) => PoolLike;
}>;

function wrapQueryable(
  queryable: Queryable,
  beginTransaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => Promise<unknown>,
): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ) {
      throwIfSqlAborted(options.signal);
      const driverResult = await queryable.query(text, values);
      throwIfSqlAborted(options.signal);
      const result = lastDriverResult(driverResult);
      const rows = result?.rows ?? [];
      return { rows: rows as T[], rowCount: result?.rowCount ?? rows.length };
    },
    transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
      return beginTransaction(fn as (tx: SqlExecutor) => Promise<unknown>) as Promise<T>;
    },
  };
}

let runtimeExecutor: SqlExecutor | null = null;

export function getSqlExecutor(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SqlExecutor {
  if (runtimeExecutor) return runtimeExecutor;
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL persistence");
  runtimeExecutor = createPostgresSqlExecutor(connectionString);
  return runtimeExecutor;
}

export function createPostgresSqlExecutor(
  connectionString: string,
  options: PostgresSqlExecutorOptions = {},
): SqlExecutor {
  let pool: PoolLike | undefined;
  let disposed = false;
  const schemaName = options.schema === undefined ? null : options.schema;
  const schema = schemaName === null ? null : postgresIdentifier(schemaName);
  const getPool = () => {
    if (disposed) throw new Error("PostgreSQL executor is disposed");
    if (!pool) {
      const poolConfig = {
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      };
      pool = options.poolFactory?.(poolConfig) ?? new Pool(poolConfig);
      pool.on("error", (error) => {
        // Idle clients can be reset between serverless invocations. Log only
        // the SQLSTATE so the process survives without leaking connection details.
        console.warn("postgres idle client error", (error as { code?: string }).code ?? "unknown");
      });
    }
    return pool;
  };

  const beginTransaction = async <Result>(
    fn: (tx: SqlExecutor) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> => {
    throwIfSqlAborted(signal);
    const client: PoolClientLike = await getPool().connect();
    const tx = wrapQueryable(client, () => {
      throw new Error("nested transactions are not supported");
    });
    try {
      throwIfSqlAborted(signal);
      await client.query("BEGIN");
      if (schema && schemaName) {
        const existing = lastDriverResult(
          await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]),
        );
        if (existing?.rows?.length !== 1) throw new Error(`PostgreSQL schema ${schemaName} does not exist`);
        await client.query(`SET LOCAL search_path TO ${schema}`);
      }
      const result = await fn(tx);
      throwIfSqlAborted(signal);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Keep the original error.
      }
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

function lastDriverResult(
  result: DriverQueryResult | DriverQueryResult[],
): DriverQueryResult | undefined {
  return Array.isArray(result) ? result.at(-1) : result;
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
