
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {  PreparedMoneyAction } from "@/shared/money-actions/types";

export type PrepareActionResponse = PreparedMoneyAction;

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
