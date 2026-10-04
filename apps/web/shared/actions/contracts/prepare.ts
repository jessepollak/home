import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";
import { isRecord, isUnknownArray } from "@/shared/guards";
import { parseMoneyActionCalls } from "@/shared/money-actions/calls";
import { CARD_ALLOWANCE_PREPARE_ERRORS, parseCardAllowanceMetadata, type CardAllowancePrepareErrorCode } from "@/shared/cards/allowance-contract";

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

export type PrepareActionErrorResponse = { error: { code: CashoutPrepareErrorCode | CardAllowancePrepareErrorCode; message: string } };

const PREPARE_ERROR_CODES: readonly (CashoutPrepareErrorCode | CardAllowancePrepareErrorCode)[] =
  [...CASHOUT_PREPARE_ERROR_CODES, ...Object.values(CARD_ALLOWANCE_PREPARE_ERRORS).map((entry) => entry.code)];
function isPrepareErrorCode(value: unknown): value is CashoutPrepareErrorCode | CardAllowancePrepareErrorCode {
  return typeof value === "string" && PREPARE_ERROR_CODES.some((code) => code === value);
}
export function parsePrepareActionErrorResponse(value: unknown): PrepareActionErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  if (typeof message !== "string" || !isPrepareErrorCode(code)) return null;
  return { error: { code, message } };
}

export const PRODUCT_NOT_OFFERED_CODE = "PRODUCT_NOT_OFFERED";
export const PRODUCT_NOT_OFFERED_MESSAGE = "This is no longer offered.";

export type ProductNotOfferedPrepareErrorResponse = { error: { code: typeof PRODUCT_NOT_OFFERED_CODE; message: string } };

export function parseProductNotOfferedPrepareErrorResponse(value: unknown): ProductNotOfferedPrepareErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const { code, message } = value.error;
  if (code !== PRODUCT_NOT_OFFERED_CODE || typeof message !== "string") return null;
  return { error: { code: PRODUCT_NOT_OFFERED_CODE, message } };
}

export function parsePreparedAction(
  value: unknown,
  session: VerifiedAccountSession,
): PrepareActionResponse | null {
  if (!isPreparedShape(value, session)) return null;
  const calls = parseMoneyActionCalls(value.calls);
  if (!calls) return null;
  if (value.networkFee !== undefined) {
    const fee = parseMoneyActionNetworkFee(value.networkFee);
    if (!fee) return null;
    if (fee.payment === "usdc") {
      const first = calls[0];
      if (!first || first.to !== fee.token.toLowerCase() ||
        !/^0x095ea7b3[0-9a-f]{128}$/.test(first.data) ||
        first.data.slice(10, 34) !== "0".repeat(24) ||
        first.data.slice(34, 74) !== fee.paymaster.slice(2).toLowerCase() ||
        BigInt(`0x${first.data.slice(74)}`).toString(10) !== fee.maxFeeBaseUnits) return null;
    }
  }
  return { ...value, calls };
}

function isPreparedShape(value: unknown, session: VerifiedAccountSession): value is PrepareActionResponse {
  if (!isRecord(value) || typeof value.id !== "string" ||
    !isRecord(value.owner) || !session.smartAccount ||
    value.owner.subject !== session.user.subject ||
    typeof value.owner.address !== "string" ||
    value.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase() ||
    value.owner.accountProvider !== session.accountProvider ||
    !isUnknownArray(value.calls) || !isUnknownArray(value.amounts) || !isUnknownArray(value.warnings)
  ) return false;
  if (value.kind === "card-allowance" && (value.amounts.length !== 0 || !parseCardAllowanceMetadata(value.metadata))) return false;
  return !(value.kind !== "card-allowance" && isRecord(value.metadata) && value.metadata.product === "card");
}
