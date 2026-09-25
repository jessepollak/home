import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { PreparedMoneyAction } from "@/shared/money-actions/types";
import { parseMoneyActionNetworkFee } from "@/shared/money-actions/network-fee";

export type PrepareActionResponse = PreparedMoneyAction;

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
    !Array.isArray(value.calls) || !Array.isArray(value.amounts) || !Array.isArray(value.warnings)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
