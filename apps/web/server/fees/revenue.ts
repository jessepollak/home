import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { OperatorRevenueEntry, OperatorRevenueSummary } from "@/shared/fees/revenue";
import { parseHash32 } from "@/shared/chain/hex";

export const OPERATOR_REVENUE_MAX_DAYS = 366;
export const OPERATOR_REVENUE_MAX_ENTRIES = 200;

type EntryRow = {
  action_id: string;
  action_kind: OperatorRevenueEntry["actionKind"];
  recorded_at: Date | string;
  amount_base_units: string;
  bps: number;
  recipient: `0x${string}`;
  collected_by: OperatorRevenueEntry["collectedBy"];
  outcome: OperatorRevenueEntry["result"] | null;
  transaction_hash: string | null;
};

type SummaryRow = {
  amount: string;
  daily: Array<{ date: string; amount: string }>;
  recent: EntryRow[];
};

const REVENUE_QUERY = `WITH succeeded AS (
  SELECT f.amount_base_units,
         (coalesce(a.outcome_recorded_at, f.recorded_at) AT TIME ZONE 'UTC')::date AS day
  FROM operator_fee_records f JOIN actions a ON a.id = f.action_id
  WHERE a.outcome = 'succeeded'
),
totals AS (SELECT COALESCE(sum(amount_base_units), 0)::text AS amount FROM succeeded),
daily AS (
  SELECT to_char(day, 'YYYY-MM-DD') AS date, sum(amount_base_units)::text AS amount
  FROM succeeded
  WHERE day BETWEEN $1::date AND $2::date
  GROUP BY 1 ORDER BY 1
),
recent AS (
  SELECT f.id, f.action_id, f.action_kind, f.recorded_at, f.amount_base_units::text AS amount_base_units,
         f.bps, f.recipient, f.collected_by, a.outcome, a.transaction_hash
  FROM operator_fee_records f JOIN actions a ON a.id = f.action_id
  ORDER BY f.recorded_at DESC, f.id DESC LIMIT $3
)
SELECT
  (SELECT amount FROM totals) AS amount,
  COALESCE((SELECT json_agg(json_build_object('date', date, 'amount', amount) ORDER BY date) FROM daily), '[]'::json) AS daily,
  COALESCE((SELECT json_agg(json_build_object(
    'action_id', action_id, 'action_kind', action_kind, 'recorded_at', recorded_at,
    'amount_base_units', amount_base_units, 'bps', bps, 'recipient', recipient,
    'collected_by', collected_by, 'outcome', outcome, 'transaction_hash', transaction_hash
  ) ORDER BY recorded_at DESC, id DESC) FROM recent), '[]'::json) AS recent`;

export async function readOperatorRevenue(
  sql: SqlExecutor,
  options: { now?: Date; days?: number; limit?: number } = {},
): Promise<OperatorRevenueSummary> {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  const limit = options.limit ?? 50;
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid revenue date.");
  if (!Number.isSafeInteger(days) || days < 1 || days > OPERATOR_REVENUE_MAX_DAYS) {
    throw new Error(`Revenue days must be an integer between 1 and ${OPERATOR_REVENUE_MAX_DAYS}.`);
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OPERATOR_REVENUE_MAX_ENTRIES) {
    throw new Error(`Revenue limit must be an integer between 1 and ${OPERATOR_REVENUE_MAX_ENTRIES}.`);
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const firstDay = new Date(today - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const lastDay = new Date(today).toISOString().slice(0, 10);

  const { rows } = await sql.query<SummaryRow>(REVENUE_QUERY, [firstDay, lastDay, limit]);
  const summary = rows[0];
  if (!summary) throw new Error("Revenue summary row missing.");
  const amounts = new Map((summary?.daily ?? []).map(({ date, amount }) => [date, amount]));
  const entries: OperatorRevenueEntry[] = (summary?.recent ?? []).map((row) => {
    const hash = row.transaction_hash?.toLowerCase() ?? null;
    return {
      actionId: row.action_id, actionKind: row.action_kind, recordedAt: new Date(row.recorded_at).toISOString(),
      amountBaseUnits: row.amount_base_units, symbol: "USDC", decimals: 6, bps: row.bps,
      recipient: row.recipient, collectedBy: row.collected_by, result: row.outcome ?? "unresolved",
      transactionHash: parseHash32(hash),
    };
  });
  return {
    collectedBaseUnits: summary?.amount ?? "0",
    days: Array.from({ length: days }, (_, index) => {
      const date = new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
      return { date, collectedBaseUnits: amounts.get(date) ?? "0" };
    }),
    entries,
  };
}
