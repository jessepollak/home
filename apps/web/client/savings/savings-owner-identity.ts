import type { VerifiedAccountSession } from "@/shared/account/session-types";

export function savingsDialogOwnerIdentity(session: VerifiedAccountSession): string {
  return `${session.user.subject}\u0000${session.smartAccount?.address.toLowerCase() ?? ""}\u0000${session.smartAccount?.chainId ?? ""}\u0000${session.accountProvider}`;
}
