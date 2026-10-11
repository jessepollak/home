import "server-only";

import type { SqlExecutor } from "@/server/db/sql";

export async function assertNoAccountDeletions(sql: SqlExecutor): Promise<void> {
  const table = (await sql.query<{ name: string | null }>("SELECT to_regclass('account_deletion_requests')::text AS name")).rows[0];
  if (!table?.name) return;
  await sql.query("LOCK TABLE account_deletion_requests IN SHARE MODE");
  const deletionData = await sql.query(
    "SELECT 1 WHERE EXISTS (SELECT 1 FROM account_deletion_requests) OR EXISTS (SELECT 1 FROM customers WHERE retained_until IS NOT NULL)",
  );
  if (deletionData.rowCount) {
    throw new Error("Legacy registry backfills are unsupported once an account deletion request exists.");
  }
}
