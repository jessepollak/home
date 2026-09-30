
import { parseAddress } from "@/shared/chain/hex";
import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { ActionSummaryResponse } from "./get";
import { CASHOUT_PREPARE_ERRORS } from "./prepare";

const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const MAX_UINT256_DECIMAL_DIGITS = MAX_UINT256.toString().length;

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
  if (!isRecord(value) || !Array.isArray(value.calls) || value.calls.length === 0) return null;
  if (value.batchGasLimit !== undefined && !isValidBatchGasLimit(value.batchGasLimit)) {
    return null;
  }
  const calls: MoneyActionCall[] = [];
  for (const call of value.calls) {
    const parsed = parseConfirmCall(call);
    if (!parsed) return null;
    calls.push(parsed);
  }
  return {
    calls,
    ...(value.batchGasLimit === undefined ? {} : { batchGasLimit: value.batchGasLimit }),
  };
}

function parseConfirmCall(call: unknown): MoneyActionCall | null {
  if (!isPlainRecord(call)) return null;
  const to = parseAddress(call.to);
  if (!to || /^0x0{40}$/.test(to) || typeof call.data !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(call.data) || typeof call.value !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/.test(call.value) || call.value.length > MAX_UINT256_DECIMAL_DIGITS ||
    BigInt(call.value) > MAX_UINT256) return null;

  let approval: MoneyActionCall["approval"];
  if (call.approval !== undefined) {
    if (!isPlainRecord(call.approval) || typeof call.approval.assetId !== "string") return null;
    const assetId = call.approval.assetId.trim();
    const spender = parseAddress(call.approval.spender);
    if (assetId.length < 1 || assetId.length > 200 || !spender || /^0x0{40}$/.test(spender)) return null;
    approval = { assetId, spender };
  }

  return {
    to,
    data: call.data.toLowerCase() as `0x${string}`,
    value: call.value,
    ...(approval ? { approval } : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
