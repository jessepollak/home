import "server-only";

import { getSqlExecutor } from "@/server/db/sql";
import { sweepAccountDeletions } from "./sweep";

const sql = getSqlExecutor();
try {
  console.log(`Account deletion sweep: ${JSON.stringify(await sweepAccountDeletions(sql))}.`);
} finally {
  await sql.dispose?.();
}
