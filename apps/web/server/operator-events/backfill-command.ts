import "server-only";

import { getSqlExecutor } from "@/server/db/sql";
import { assertNoAccountDeletions } from "@/server/operator-events/backfill-guard";
import { backfillOperatorRegistry } from "./backfill";

const sql = getSqlExecutor();
try {
  const counts = await sql.transaction(async (tx) => {
    await assertNoAccountDeletions(tx);
    return backfillOperatorRegistry(tx);
  });
  console.log(`Operator registry backfill: ${counts.customers} customers, ${counts.events} events.`);
} finally {
  await sql.dispose?.();
}
