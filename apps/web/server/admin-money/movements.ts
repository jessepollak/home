import "server-only";

import type { SqlExecutor, SqlQueryOptions } from "@/server/db/sql";
import { parseHash32 } from "@/shared/chain/hex";
import { parseMoneyMovementCursor, type MoneyExportRange, type MoneyMovement, type MoneyMovementStatus } from "@/shared/admin-money/contract";

type MovementRow = {
  id: string;
  action_id: string;
  recorded_at: Date | string;
  amount_base_units: string;
  bps: number;
  customer_id: string | null;
  outcome: Exclude<MoneyMovementStatus, "unresolved"> | null;
  transaction_hash: string | null;
  cursor: string;
};

const FEE_MOVEMENTS_QUERY = `SELECT f.id::text AS id, f.action_id::text AS action_id, f.recorded_at, f.amount_base_units::text AS amount_base_units,
       f.bps, a.customer_id::text AS customer_id, a.outcome, a.transaction_hash,
       (extract(epoch FROM f.recorded_at) * 1000000)::bigint::text || '.' || f.id::text AS cursor
  FROM operator_fee_records f JOIN actions a ON a.id = f.action_id
 WHERE f.recorded_at >= $1::timestamptz AND f.recorded_at < $2::timestamptz
   AND ($4::bigint IS NULL OR (f.recorded_at <= 'epoch'::timestamptz + $4::bigint * interval '1 microsecond'
     AND (f.recorded_at, f.id) < ('epoch'::timestamptz + $4::bigint * interval '1 microsecond', $5::bigint)))
 ORDER BY f.recorded_at DESC, f.id DESC
 LIMIT $3`;

function bounds(range: MoneyExportRange): [string, string] {
  const from = range.from === null ? "-infinity" : `${range.from}T00:00:00.000Z`;
  const to = range.to === null ? "infinity" : new Date(Date.parse(`${range.to}T00:00:00.000Z`) + 86_400_000).toISOString();
  return [from, to];
}

function movement(row: MovementRow): MoneyMovement {
  return {
    id: `fee:${row.action_id}`,
    occurredAt: new Date(row.recorded_at).toISOString(),
    category: "fee",
    amountBaseUnits: row.amount_base_units,
    decimals: 6,
    bps: row.bps,
    customerId: row.customer_id,
    payoutAddress: null,
    transactionHash: parseHash32(row.transaction_hash),
    status: row.outcome ?? "unresolved",
  };
}

export async function listMoneyMovements(
  sql: SqlExecutor,
  input: { range: MoneyExportRange; limit: number; before?: string | null },
  options: SqlQueryOptions = {},
): Promise<{ rows: MoneyMovement[]; next: string | null }> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("Invalid movement limit");
  const before = input.before == null ? null : parseMoneyMovementCursor(input.before);
  if (input.before != null && !before) throw new Error("Invalid movement cursor");
  const [from, to] = bounds(input.range);
  const { rows } = await sql.query<MovementRow>(FEE_MOVEMENTS_QUERY, [from, to, input.limit + 1, before?.recordedAtMicros ?? null, before?.id ?? null], options);
  const page = rows.slice(0, input.limit);
  return { rows: page.map(movement), next: rows.length > input.limit ? page.at(-1)?.cursor ?? null : null };
}
