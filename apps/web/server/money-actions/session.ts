import "server-only";

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { MoneyActionOwner } from "@/shared/money-actions/types";

export function moneyActionOwner(session: VerifiedAccountSession): MoneyActionOwner | null {
  return session.smartAccount
    ? {
        subject: session.user.subject,
        address: session.smartAccount.address.toLowerCase() as `0x${string}`,
        chainId: 8453,
        accountProvider: session.accountProvider,
      }
    : null;
}
