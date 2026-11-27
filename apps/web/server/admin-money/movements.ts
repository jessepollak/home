import "server-only";

import type { SqlExecutor, SqlQueryOptions } from "@/server/db/sql";
import { parseHash32 } from "@/shared/chain/hex";
import { isMoneyMovementCursor, type MoneyExportRange, type MoneyMovement, type MoneyMovementStatus } from "@/shared/admin-money/contract";

type MovementRow = {
  id: string;
  action_id: string;
  recorded_at: Date | string;
  amount_base_units: string;
  bps: number;
  customer_id: string | null;
  outcome: Exclude<MoneyMovementStatus, "unresolved"> | null;
  transaction_hash: string | null;
};

const FEE_EXPORT_HEAD_QUERY = `SELECT
  (SELECT f.id::text FROM operator_fee_records f WHERE f.recorded_at >= $1::timestamptz AND f.recorded_at < $2::timestamptz
    ORDER BY f.recorded_at DESC, f.id DESC LIMIT 1) AS id,
  (SELECT count(*) FROM operator_fee_records f WHERE f.recorded_at >= $1::timestamptz AND f.recorded_at < $2::timestamptz)::text AS count`;

const FEE_MOVEMENTS_QUERY = `SELECT f.id::text AS id, f.action_id::text AS action_id, f.recorded_at, f.amount_base_units::text AS amount_base_units,
       f.bps, a.customer_id::text AS customer_id, a.outcome, a.transaction_hash
  FROM operator_fee_records f JOIN actions a ON a.id = f.action_id
 WHERE f.recorded_at >= $1::timestamptz AND f.recorded_at < $2::timestamptz
   AND ($4::bigint IS NULL OR (f.recorded_at, f.id) < (SELECT c.recorded_at, c.id FROM operator_fee_records c WHERE c.id = $4::bigint))
   AND ($5::bigint IS NULL OR (f.recorded_at, f.id) <= (SELECT c.recorded_at, c.id FROM operator_fee_records c WHERE c.id = $5::bigint))
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
  input: { range: MoneyExportRange; limit: number; before?: string | null; through?: string | null },
  options: SqlQueryOptions = {},
): Promise<{ rows: MoneyMovement[]; next: string | null }> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("Invalid movement limit");
  if ((input.before != null && !isMoneyMovementCursor(input.before)) || (input.through != null && !isMoneyMovementCursor(input.through))) throw new Error("Invalid movement cursor");
  const [from, to] = bounds(input.range);
  const { rows } = await sql.query<MovementRow>(FEE_MOVEMENTS_QUERY, [from, to, input.limit + 1, input.before ?? null, input.through ?? null], options);
  const page = rows.slice(0, input.limit);
  return { rows: page.map(movement), next: rows.length > input.limit ? page.at(-1)?.id ?? null : null };
}

export async function readMoneyExportHead(sql: SqlExecutor, range: MoneyExportRange, options: SqlQueryOptions = {}): Promise<{ through: string | null; rows: number }> {
  const [from, to] = bounds(range);
  const { rows } = await sql.query<{ id: string | null; count: string }>(FEE_EXPORT_HEAD_QUERY, [from, to], options);
  const head = rows[0];
  if (!head) throw new Error("Export head row missing");
  return { through: head.id, rows: Number(head.count) };
}
