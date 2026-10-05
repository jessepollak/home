import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";

export type SqlQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
};

export type SqlQueryOptions = {
  signal?: AbortSignal;
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
  attachPool?: (pool: PoolLike) => void;
}>;

function wrapQueryable(
  queryable: Queryable,
  beginTransaction: (fn: (tx: SqlExecutor) => Promise<unknown>) => Promise<unknown>,
  raceDriverQuery: <T>(work: Promise<T>) => Promise<T>,
): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ) {
      throwIfSqlAborted(options.signal);
      const driverResult = await raceDriverQuery(queryable.query(text, values));
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
  env: Readonly<Record<string, string | undefined>> = serverEnvironment(),
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
      pool = options.poolFactory?.(poolConfig);
      if (!pool) {
        const created = new Pool(poolConfig);
        (options.attachPool ?? attachDatabasePool)(created);
        pool = created;
      }
      pool.on("error", (error) => {
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
    const client: PoolClientLike = await raceAbort(getPool().connect(), signal, { settleLate: (late) => late.release() });
    let released = false;
    let poisoned = false;
    let started = false;
    const releaseClient = (destroy?: boolean) => {
      if (released) return;
      released = true;
      client.release(destroy ?? (poisoned ? true : undefined));
    };
    const runDriverQuery = <T>(work: Promise<T>): Promise<T> => raceAbort(work, signal, { onAbort: () => { poisoned = true; } });
    const tx = wrapQueryable(client, () => {
      throw new Error("nested transactions are not supported");
    }, runDriverQuery);
    try {
      throwIfSqlAborted(signal);
      await runDriverQuery(client.query("BEGIN"));
      started = true;
      if (schema && schemaName) {
        const existing = lastDriverResult(
          await runDriverQuery(client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName])),
        );
        if (existing?.rows?.length !== 1) throw new Error(`PostgreSQL schema ${schemaName} does not exist`);
        await runDriverQuery(client.query(`SET LOCAL search_path TO ${schema}`));
      }
      const result = await fn(tx);
      throwIfSqlAborted(signal);
      await runDriverQuery(client.query("COMMIT"));
      return result;
    } catch (error) {
      if (started && signal?.aborted) poisoned = true;
      if (!poisoned && started) {
        try {
          await runDriverQuery(client.query("ROLLBACK"));
        } catch { // oxlint-disable-line home/no-silent-catch -- a failed rollback cannot mask the transaction error that is rethrown
        }
      }
      throw error;
    } finally {
      releaseClient();
    }
  };

  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
      options: SqlQueryOptions = {},
    ) {
      const timeoutMs = boundedSqlTimeoutMs(options.timeoutMs);
      const deadline = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
      const signal = deadline === null
        ? options.signal
        : options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
      return beginTransaction(
        async (tx) => {
          if (timeoutMs !== null) {
            await tx.query(
              "SELECT set_config('statement_timeout', $1, true)",
              [`${timeoutMs}ms`],
              { signal },
            );
          }
          return tx.query<T>(text, values, { signal });
        },
        signal,
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

function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined, handlers: { onAbort?: () => void; settleLate?: (value: T) => void } = {}): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      handlers.onAbort?.();
      reject(signal.reason ?? new Error("PostgreSQL query aborted"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(value);
          return;
        }
        handlers.settleLate?.(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
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
