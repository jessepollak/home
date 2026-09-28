
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { ActionSummaryResponse } from "./get";
import { CASHOUT_PREPARE_ERRORS } from "./prepare";

export const CONFIRM_CASHOUT_ERRORS = {
  unavailable: CASHOUT_PREPARE_ERRORS.unavailable,
  "settings-unavailable": CASHOUT_PREPARE_ERRORS["settings-unavailable"],
} as const;

export type ConfirmActionErrorCode = (typeof CONFIRM_CASHOUT_ERRORS)[keyof typeof CONFIRM_CASHOUT_ERRORS]["code"];
const CONFIRM_ACTION_ERROR_CODES: readonly ConfirmActionErrorCode[] = Object.values(CONFIRM_CASHOUT_ERRORS).map((entry) => entry.code);

export type ConfirmActionErrorResponse = { error: { code: ConfirmActionErrorCode; message: string } };

export function parseConfirmActionErrorResponse(value: unknown): ConfirmActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  if (typeof message !== "string" || typeof code !== "string" || !(CONFIRM_ACTION_ERROR_CODES as readonly string[]).includes(code)) return null;
  return { error: { code: code as ConfirmActionErrorCode, message } };
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
  for (let index = 1; index < calls.length - 1; index += 1) {
    if (!/^0x095ea7b3[0-9a-f]{128}$/i.test(calls[index].data)) return false;
  }
  return true;
}

export function parseConfirmActionResponse(
  value: unknown,
): Pick<ConfirmActionResponse, "calls" | "batchGasLimit"> | null {
  if (!isRecord(value) || !Array.isArray(value.calls)) return null;
  if (value.batchGasLimit !== undefined && !isValidBatchGasLimit(value.batchGasLimit)) {
    return null;
  }
  return {
    calls: value.calls as ConfirmActionResponse["calls"],
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
