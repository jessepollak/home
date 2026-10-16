import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import { requireTombstoneKey } from "./tombstone";
import { AccountDeletionStore } from "./store";

export async function sweepAccountDeletions(sql: SqlExecutor, options: { batchSize?: number; now?: Date } = {}) {
  requireTombstoneKey();
  const limit = options.batchSize ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("Invalid deletion sweep batch size");
  const now = options.now ?? new Date();
  const counts = { completed: 0, blocked: 0, failed: 0, expiredOwners: 0, expiredRequests: 0 };
  const store = new AccountDeletionStore(sql, () => now);
  const queued = (await sql.query<{ id: string }>("SELECT id FROM account_deletion_requests WHERE status='queued' ORDER BY last_attempt_at NULLS FIRST,id LIMIT $1", [limit])).rows;
  for (const request of queued) {
    const outcome = await attemptQueued(store, request.id);
    counts[outcome]++;
  }
  counts.expiredOwners = await sql.transaction(async (tx) => {
    await tx.query("SET LOCAL statement_timeout='30s'");
    const owners = (await tx.query<{ id: string }>("SELECT id FROM customers WHERE retained_until<=$1 ORDER BY retained_until,id LIMIT $2 FOR UPDATE SKIP LOCKED", [now, limit])).rows.map((row) => row.id);
    if (!owners.length) return 0;
    await tx.query("DELETE FROM actions WHERE customer_id=ANY($1::uuid[])", [owners]);
    await tx.query("DELETE FROM funding_orders WHERE customer_id=ANY($1::uuid[])", [owners]);
    await tx.query("DELETE FROM customers WHERE id=ANY($1::uuid[])", [owners]);
    return owners.length;
  });
  counts.expiredRequests = await sql.transaction(async (tx) => {
    await tx.query("SET LOCAL statement_timeout='30s'");
    const targets = (await tx.query<{ target_id: string }>("SELECT target_id FROM account_deletion_audit_expiry WHERE expires_at<=$1 AND expires_at<=now() ORDER BY expires_at,target_id LIMIT $2 FOR UPDATE SKIP LOCKED", [now, limit])).rows.map((row) => row.target_id);
    await tx.query("DELETE FROM admin_audit_log WHERE target_kind='customer' AND target_id=ANY($1::text[])", [targets]);
    await tx.query("DELETE FROM account_deletion_audit_expiry WHERE target_id=ANY($1::text[])", [targets]);
    const result = await tx.query("DELETE FROM account_deletion_requests WHERE id IN (SELECT id FROM account_deletion_requests WHERE status='completed' AND expires_at<=$1 ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)", [now, limit]);
    return result.rowCount;
  });
  return counts;
}

async function attemptQueued(store: AccountDeletionStore, id: string): Promise<"completed" | "blocked" | "failed"> {
  try {
    const receipt = await store.attempt(id);
    return receipt.status === "completed" ? "completed" : receipt.lastAttempt?.outcome === "failed" ? "failed" : "blocked";
  }
  catch { return "failed"; }
}
