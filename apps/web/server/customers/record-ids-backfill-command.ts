import "server-only";

import { getSqlExecutor } from "@/server/db/sql";
import { backfillRecordCustomerIds } from "./record-ids-backfill";

const sql = getSqlExecutor();
try {
  const counts = await sql.transaction(backfillRecordCustomerIds);
  console.log(`Record customer IDs backfill: updated ${JSON.stringify(counts.updated)}, unresolved ${JSON.stringify(counts.unresolved)}.`);
} finally {
  await sql.dispose?.();
}
