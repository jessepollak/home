import "server-only";

import { getSqlExecutor } from "@/server/db/sql";
import { backfillOperatorRegistry } from "./backfill";

const sql = getSqlExecutor();
try {
  const counts = await sql.transaction(backfillOperatorRegistry);
  console.log(`Operator registry backfill: ${counts.customers} customers, ${counts.events} events.`);
} finally {
  await sql.dispose?.();
}
