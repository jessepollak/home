// Route contract.
// POST /api/actions/prepare

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActionKind, PreparedMoneyAction } from "@/shared/money-actions/types";

export type PrepareActionRequest = {
  kind: ActionKind;
  params: Record<string, unknown>;
};

export type PrepareActionResponse = PreparedMoneyAction;

export type PrepareActionErrorCode =
  | "AUTH_UNAVAILABLE"
  | "INVALID_ACTION"
  | "SAVINGS_ACTION_INVALID"
  | "SAVINGS_ACTION_UNSUPPORTED"
  | "SAVINGS_ACTION_LIMIT_EXCEEDED"
  | "SAVINGS_ACTION_RATE_LIMITED"
  | "SAVINGS_ACTION_RPC"
  | "SAVINGS_ACTION_UNAVAILABLE"
  | "INVALID_SEND_REQUEST"
  | "ACTION_PREPARE_UNAVAILABLE"
  | string;

export function validPrepared(
  value: unknown,
  session: VerifiedAccountSession,
): value is PrepareActionResponse {
  return Boolean(
    isRecord(value) && typeof value.id === "string" &&
    isRecord(value.owner) && session.smartAccount &&
    value.owner.subject === session.user.subject &&
    typeof value.owner.address === "string" &&
    value.owner.address.toLowerCase() === session.smartAccount.address.toLowerCase() &&
    value.owner.accountProvider === session.accountProvider &&
    Array.isArray(value.calls) && Array.isArray(value.amounts) && Array.isArray(value.warnings),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
