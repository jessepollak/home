import "server-only";

import {
  postgresIdentifier,
  type SqlExecutor,
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
  let disposed = false;

  return {
    async query<Row = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
    ): Promise<SqlQueryResult<Row>> {
      const result = await client.unsafe(text, values);
      const rows = Array.from(result) as Row[];
      return { rows, rowCount: result.count ?? rows.length };
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
      if (inTransaction) throw new Error("nested money-action transactions are not supported");
      return client.begin(async (transaction) => {
        if (schema) {
          const existing = await transaction.unsafe(
            "SELECT 1 FROM pg_namespace WHERE nspname = $1",
            [options.schema],
          );
          if (Array.from(existing).length !== 1) {
            throw new Error(`PostgreSQL schema ${options.schema} does not exist`);
          }
          await transaction.unsafe(`SET LOCAL search_path TO ${schema}`);
        }
        return run(createBunSqlExecutor(transaction, { inTransaction: true }));
      });
    },
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
