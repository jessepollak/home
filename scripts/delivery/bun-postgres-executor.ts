import type { SqlExecutor, SqlQueryResult } from "../../apps/web/server/money-actions/postgres-sql";

type BunSqlClient = {
  unsafe: (text: string, values?: unknown[]) => Promise<ArrayLike<unknown> & { count?: number }>;
  begin: <T>(callback: (transaction: BunSqlClient) => Promise<T>) => Promise<T>;
};

function schemaIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("unsafe PostgreSQL fixture schema");
  return `"${value}"`;
}

function resultFromRows<Row>(rows: ArrayLike<unknown> & { count?: number }): SqlQueryResult<Row> {
  const normalized = Array.from(rows) as Row[];
  return { rows: normalized, rowCount: rows.count ?? normalized.length };
}

export function createBunPostgresExecutor(
  client: BunSqlClient,
  schema: string,
  inTransaction = false,
): SqlExecutor {
  const quotedSchema = schemaIdentifier(schema);

  return {
    async query<Row>(text: string, values: unknown[] = []): Promise<SqlQueryResult<Row>> {
      if (inTransaction) {
        return resultFromRows<Row>(await client.unsafe(text, values));
      }
      return client.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`);
        return resultFromRows<Row>(await transaction.unsafe(text, values));
      });
    },
    async transaction<T>(run: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
      if (inTransaction) throw new Error("nested transaction is not supported");
      return client.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`);
        return run(createBunPostgresExecutor(transaction, schema, true));
      });
    },
  };
}
