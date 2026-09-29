import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import { isRecord, isUnknownArray } from "@/shared/guards";

export type PrepareActionResponse = PreparedMoneyAction;
export const CASHOUT_PREPARE_ERRORS = {
  "invalid-input": { code: "CASHOUT_INVALID_INPUT", status: 400 },
  unavailable: { code: "CASHOUT_UNAVAILABLE", status: 502 },
  "duplicate-unknown": { code: "CASHOUT_DUPLICATE_UNKNOWN", status: 409 },
  "order-in-flight": { code: "CASHOUT_ORDER_IN_FLIGHT", status: 409 },
  "not-withdrawable": { code: "CASHOUT_NOT_WITHDRAWABLE", status: 422 },
  "settings-unavailable": { code: "CASHOUT_SETTINGS_UNAVAILABLE", status: 503 },
} as const;

export type CashoutPrepareErrorReason = keyof typeof CASHOUT_PREPARE_ERRORS;
export type CashoutPrepareErrorCode = (typeof CASHOUT_PREPARE_ERRORS)[CashoutPrepareErrorReason]["code"];
export const CASHOUT_PREPARE_ERROR_CODES: readonly CashoutPrepareErrorCode[] = Object.values(CASHOUT_PREPARE_ERRORS).map((entry) => entry.code);

export function cashoutPrepareErrorResponse(reason: CashoutPrepareErrorReason) {
  return CASHOUT_PREPARE_ERRORS[reason];
}

export function isCashoutPrepareErrorCode(value: unknown): value is CashoutPrepareErrorCode {
  return typeof value === "string" && (CASHOUT_PREPARE_ERROR_CODES as readonly string[]).includes(value);
}

export type PrepareActionErrorResponse = { error: { code: CashoutPrepareErrorCode; message: string } };

export function parseCashoutPrepareErrorResponse(value: unknown): PrepareActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  if (typeof message !== "string" || !isCashoutPrepareErrorCode(code)) return null;
  return { error: { code, message } };
}

export function validPrepared(
  value: unknown,
  session: VerifiedAccountSession,
): value is PrepareActionResponse {
  if (!isRecord(value) || typeof value.id !== "string" ||
    !isRecord(value.owner) || !session.smartAccount ||
    value.owner.subject !== session.user.subject ||
    typeof value.owner.address !== "string" ||
    value.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
    value.owner.accountProvider !== session.accountProvider ||
    !isUnknownArray(value.calls) || !isUnknownArray(value.amounts) || !isUnknownArray(value.warnings)
  ) return false;
  if (value.networkFee === undefined) return true;
  const fee = parseMoneyActionNetworkFee(value.networkFee);
  if (!fee) return false;
  if (fee.payment === "native") return true;
  const first = value.calls[0];
  return isRecord(first) && typeof first.to === "string" &&
    first.to.toLowerCase() === fee.token.toLowerCase() &&
    typeof first.data === "string" &&
    /^0x095ea7b3[0-9a-fA-F]{128}$/.test(first.data) &&
    first.data.slice(10, 34) === "0".repeat(24) &&
    first.data.slice(34, 74).toLowerCase() === fee.paymaster.slice(2).toLowerCase() &&
    BigInt(`0x${first.data.slice(74)}`).toString(10) === fee.maxFeeBaseUnits;
}
