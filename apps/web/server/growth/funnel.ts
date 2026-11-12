import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { InviteRewardState } from "@/shared/growth/reward";

/** @public aggregate operator metrics; budget remaining uses current settings at the caller. */
export async function readProgramFunnel(sql: SqlExecutor): Promise<{
  counts: Record<InviteRewardState, number>; historyPendingCount: number; reservedAtoms: string; approvedCount: number;
}> {
  const rows = (await sql.query<{ state: InviteRewardState; count: string; pending: string; reserved: string }>(`SELECT state,count(*)::text AS count,
    count(*) FILTER (WHERE state IN ('joined','saved') AND history_pending IS NOT NULL)::text AS pending,
    COALESCE(sum(reserved_atoms),0)::text AS reserved FROM invite_rewards GROUP BY state`)).rows;
  const counts: Record<InviteRewardState, number> = {
    joined: 0, saved: 0, qualified: 0, approved: 0, rejected: 0, disqualified: 0, ineligible: 0,
  };
  let historyPendingCount = 0;
  let reservedAtoms = BigInt(0);
  for (const row of rows) {
    counts[row.state] = Number(row.count);
    historyPendingCount += Number(row.pending);
    reservedAtoms += BigInt(row.reserved);
  }
  return { counts, historyPendingCount, reservedAtoms: reservedAtoms.toString(), approvedCount: counts.approved };
}
