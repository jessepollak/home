
import { parseMoneyActionCalls } from "@/shared/money-actions/calls";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { ActionSummaryResponse } from "./get";
import { CASHOUT_PREPARE_ERRORS, PRODUCT_NOT_OFFERED_CODE } from "./prepare";
import { CARD_ALLOWANCE_PREPARE_ERRORS } from "@/shared/cards/allowance-contract";

export const CONFIRM_CASHOUT_ERRORS = {
  unavailable: CASHOUT_PREPARE_ERRORS.unavailable,
  "settings-unavailable": CASHOUT_PREPARE_ERRORS["settings-unavailable"],
} as const;

export type ConfirmActionErrorCode =
  | "INVALID_ACTION"
  | "ACTION_NOT_FOUND"
  | "ACTION_EXPIRED"
  | "TRADE_STOCK_RESTRICTED"
  | "INVALID_TRADE_SIGNATURE"
  | typeof PRODUCT_NOT_OFFERED_CODE
  | (typeof CONFIRM_CASHOUT_ERRORS)[keyof typeof CONFIRM_CASHOUT_ERRORS]["code"]
  | typeof CARD_ALLOWANCE_PREPARE_ERRORS.unavailable.code
  | typeof CARD_ALLOWANCE_PREPARE_ERRORS["not-ready"]["code"];
const CONFIRM_ACTION_ERROR_CODES: readonly ConfirmActionErrorCode[] = [
  "INVALID_ACTION",
  "ACTION_NOT_FOUND",
  "ACTION_EXPIRED",
  "TRADE_STOCK_RESTRICTED",
  "INVALID_TRADE_SIGNATURE",
  PRODUCT_NOT_OFFERED_CODE,
  ...Object.values(CONFIRM_CASHOUT_ERRORS).map((entry) => entry.code),
  CARD_ALLOWANCE_PREPARE_ERRORS.unavailable.code,
  CARD_ALLOWANCE_PREPARE_ERRORS["not-ready"].code,
];

export type ConfirmActionErrorResponse = { error: { code: ConfirmActionErrorCode; message: string } };

export function isConfirmActionErrorCode(value: unknown): value is ConfirmActionErrorCode {
  return typeof value === "string" && (CONFIRM_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

export function parseConfirmActionErrorResponse(value: unknown): ConfirmActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error) ||
    !isConfirmActionErrorCode(value.error.code) || typeof value.error.message !== "string") return null;
  return { error: { code: value.error.code, message: value.error.message } };
}

export type ConfirmActionResponse = {
  id: string;
  calls: MoneyActionCall[];
  summary: ActionSummaryResponse;
  expiresAt: string;
  batchGasLimit?: string;
};

export function supportsBaseBatchGasHint(calls: readonly { data: string }[]): boolean {
  if (calls.length < 1) return false;
  const approval = (data: string) => /^0x095ea7b3[0-9a-f]{128}$/i.test(data);
  const transfer = (data: string) => /^0xa9059cbb0{24}[0-9a-f]{40}[0-9a-f]{64}$/i.test(data);
  const independent = (data: string) => approval(data) || transfer(data);
  const first = calls[0];
  if (!first) return false;
  let earlierIndependent = independent(first.data);
  for (let index = 1; index < calls.length - 1; index += 1) {
    const call = calls[index];
    if (!call) return false;
    const data = call.data;
    if (transfer(data)) {
      if (!earlierIndependent) return false;
    } else if (!approval(data)) return false;
    earlierIndependent = earlierIndependent && independent(data);
  }
  return true;
}

export function parseConfirmActionResponse(
  value: unknown,
): Pick<ConfirmActionResponse, "calls" | "batchGasLimit"> | null {
  if (!isRecord(value)) return null;
  if (value.batchGasLimit !== undefined && !isValidBatchGasLimit(value.batchGasLimit)) {
    return null;
  }
  const calls = parseMoneyActionCalls(value.calls);
  if (!calls) return null;
  return {
    calls,
    ...(value.batchGasLimit === undefined ? {} : { batchGasLimit: value.batchGasLimit }),
  };
}

function isValidBatchGasLimit(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= BigInt(2_000_000);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
