import "server-only";

import { getSqlExecutor } from "@/server/db/sql";
import { assertNoAccountDeletions } from "@/server/operator-events/backfill-guard";
import { backfillRecordCustomerIds } from "./record-ids-backfill";

const sql = getSqlExecutor();
try {
  const counts = await sql.transaction(async (tx) => {
    await assertNoAccountDeletions(tx);
    return backfillRecordCustomerIds(tx);
  });
  console.log(`Record customer IDs backfill: updated ${JSON.stringify(counts.updated)}, unresolved ${JSON.stringify(counts.unresolved)}.`);
} finally {
  await sql.dispose?.();
}
