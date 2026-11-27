import "server-only";

import type { SqlExecutor, SqlQueryOptions } from "@/server/db/sql";
import { parseHash32 } from "@/shared/chain/hex";
import type { MoneyExportRange, MoneyMovement, MoneyMovementStatus } from "@/shared/admin-money/contract";

type MovementRow = {
  action_id: string;
  recorded_at: Date | string;
  amount_base_units: string;
  customer_id: string | null;
  outcome: Exclude<MoneyMovementStatus, "unresolved"> | null;
  transaction_hash: string | null;
};

const FEE_MOVEMENTS_QUERY = `SELECT f.action_id::text AS action_id, f.recorded_at, f.amount_base_units::text AS amount_base_units,
       a.customer_id::text AS customer_id, a.outcome, a.transaction_hash
  FROM operator_fee_records f JOIN actions a ON a.id = f.action_id
 WHERE f.recorded_at >= $1::timestamptz AND f.recorded_at < $2::timestamptz
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
    customerId: row.customer_id,
    payoutAddress: null,
    transactionHash: parseHash32(row.transaction_hash),
    status: row.outcome ?? "unresolved",
  };
}

export async function listMoneyMovements(
  sql: SqlExecutor,
  input: { range: MoneyExportRange; limit: number },
  options: SqlQueryOptions = {},
): Promise<MoneyMovement[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error("Invalid movement limit");
  const [from, to] = bounds(input.range);
  const { rows } = await sql.query<MovementRow>(FEE_MOVEMENTS_QUERY, [from, to, input.limit], options);
  return rows.map(movement);
}
