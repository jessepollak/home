import "server-only";

import type { SqlExecutor } from "@/server/db/sql";
import type { OperatorRevenueSummary } from "@/shared/fees/revenue";

export const OPERATOR_REVENUE_MAX_DAYS = 366;

type SummaryRow = {
  amount: string;
  recorded: boolean;
  daily: Array<{ date: string; amount: string }>;
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
)
SELECT
  (SELECT amount FROM totals) AS amount,
  EXISTS (SELECT 1 FROM operator_fee_records) AS recorded,
  COALESCE((SELECT json_agg(json_build_object('date', date, 'amount', amount) ORDER BY date) FROM daily), '[]'::json) AS daily`;

export async function readOperatorRevenue(
  sql: SqlExecutor,
  options: { now?: Date; days?: number } = {},
): Promise<OperatorRevenueSummary> {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid revenue date.");
  if (!Number.isSafeInteger(days) || days < 1 || days > OPERATOR_REVENUE_MAX_DAYS) {
    throw new Error(`Revenue days must be an integer between 1 and ${OPERATOR_REVENUE_MAX_DAYS}.`);
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const firstDay = new Date(today - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const lastDay = new Date(today).toISOString().slice(0, 10);

  const { rows } = await sql.query<SummaryRow>(REVENUE_QUERY, [firstDay, lastDay]);
  const summary = rows[0];
  if (!summary) throw new Error("Revenue summary row missing.");
  const amounts = new Map((summary?.daily ?? []).map(({ date, amount }) => [date, amount]));
  return {
    collectedBaseUnits: summary?.amount ?? "0",
    recorded: summary.recorded === true,
    days: Array.from({ length: days }, (_, index) => {
      const date = new Date(today - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
      return { date, collectedBaseUnits: amounts.get(date) ?? "0" };
    }),
  };
}
