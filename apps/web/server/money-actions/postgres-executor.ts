import "server-only";

import { createBunSqlExecutor, isLoopbackPostgresUrl, type BunSqlClient } from "./bun-sql";
import { createNeonSqlExecutor, type SqlExecutor } from "./postgres-sql";

// Single server-only PostgreSQL executor selector. Exact loopback hosts
// (localhost, 127.0.0.1, ::1) use Bun's native SQL client for local Docker
// Postgres; every other URL keeps the hosted Neon path untouched, including
// its disposal and schema handling.
export function createPostgresSqlExecutor(
  connectionString: string,
  options: Readonly<{ schema?: string }> = {},
  connectBunSql: (connectionString: string) => BunSqlClient = (url) => new Bun.SQL(url),
): SqlExecutor {
  if (isLoopbackPostgresUrl(connectionString)) {
    return createBunSqlExecutor(connectBunSql(connectionString), options);
  }
  return createNeonSqlExecutor(connectionString, options);
}
