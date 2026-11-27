import * as z from "zod/mini";
import { formatDecimalAmount } from "@/shared/amounts/decimal";
import type { Address, Hash32 } from "@/shared/chain/hex";

export const ADMIN_MONEY_CONTRACT_VERSION = 1 as const;
export const MONEY_EXPORT_MAX_ROWS = 25_000;
export const MONEY_MOVEMENTS_PAGE_SIZE = 100;

export type MoneyMovementCategory = "fee";
export type MoneyMovementStatus = "succeeded" | "reverted" | "not_submitted" | "unresolved";

export type MoneyMovement = {
  id: string;
  occurredAt: string;
  category: MoneyMovementCategory;
  amountBaseUnits: string;
  decimals: 6;
  bps: number | null;
  customerId: string | null;
  payoutAddress: Address | null;
  transactionHash: Hash32 | null;
  status: MoneyMovementStatus;
};

export type OperatorAccountBalance =
  | { kind: "unavailable" }
  | { kind: "unset" }
  | { kind: "configured"; address: Address; usdcBaseUnits: string | null };

export type AdminMoneyPageData = {
  revenueDestination: OperatorAccountBalance;
  payoutAccount: OperatorAccountBalance;
  movements: { rows: MoneyMovement[]; next: string | null; before: string | null } | null;
};

export type MoneyExportRange = { from: string | null; to: string | null };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const cursorPattern = /^(0|-?[1-9]\d{0,16})\.([1-9]\d{0,18})$/;
const BIGINT_MAX = BigInt("9223372036854775807");

export function parseMoneyMovementCursor(value: unknown): { recordedAtMicros: string; id: string } | null {
  const match = typeof value === "string" ? cursorPattern.exec(value) : null;
  if (!match?.[1] || !match[2] || BigInt(match[2]) > BIGINT_MAX) return null;
  return { recordedAtMicros: match[1], id: match[2] };
}

export function isMoneyMovementCursor(value: unknown): value is string {
  return parseMoneyMovementCursor(value) !== null;
}

function calendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2999 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateSchema = z.nullable(z.string().check(z.refine(calendarDate)));
const exportRequestSchema = z.strictObject({
  version: z.literal(ADMIN_MONEY_CONTRACT_VERSION),
  from: dateSchema,
  to: dateSchema,
}).check(z.refine((request) => request.from === null || request.to === null || request.from <= request.to));

export const ADMIN_MONEY_ERROR_CODES = [
  "UNAUTHENTICATED", "AUTH_UNAVAILABLE", "OPERATOR_FORBIDDEN", "INVALID_REQUEST", "CROSS_ORIGIN",
  "MONEY_NOT_CONFIGURED", "MONEY_UNAVAILABLE", "EXPORT_TOO_LARGE",
] as const;
export type AdminMoneyErrorCode = (typeof ADMIN_MONEY_ERROR_CODES)[number];
const errorResponseSchema = z.object({ error: z.object({ code: z.enum(ADMIN_MONEY_ERROR_CODES) }) });

export type MoneyExportRequest = z.output<typeof exportRequestSchema>;
export type AdminMoneyErrorResponse = z.output<typeof errorResponseSchema>;

export function parseMoneyExportRequest(value: unknown): MoneyExportRequest | null {
  const result = exportRequestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseAdminMoneyErrorResponse(value: unknown): AdminMoneyErrorResponse | null {
  const result = errorResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const MONEY_EXPORT_COLUMNS = ["date", "category", "amount_usdc", "rate_bps", "customer_id", "payout_address", "transaction_hash", "status"] as const;

const formulaLead = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = formulaLead.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}

export const MONEY_EXPORT_HEADER = `${MONEY_EXPORT_COLUMNS.join(",")}\r\n`;

export function moneyMovementsCsvRows(movements: readonly MoneyMovement[]): string {
  return movements.map((movement) => `${[
    movement.occurredAt, movement.category, formatDecimalAmount(BigInt(movement.amountBaseUnits), movement.decimals),
    movement.bps === null ? "" : String(movement.bps),
    movement.customerId ?? "", movement.payoutAddress ?? "", movement.transactionHash ?? "", movement.status,
  ].map(csvCell).join(",")}\r\n`).join("");
}

export function moneyExportFilename(range: MoneyExportRange): string {
  if (range.from === null && range.to === null) return "home-money-movements.csv";
  return `home-money-movements-${range.from ?? "start"}-to-${range.to ?? "today"}.csv`;
}
