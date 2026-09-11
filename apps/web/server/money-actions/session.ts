import {
  ACCOUNT_PROVIDER_HEADER,
  type AccountProvider,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import type { MoneyActionOwner } from "@/shared/money-actions/types";

export async function readAuthorizedMoneyActionSession(
  request: Request,
  response: Response,
): Promise<VerifiedAccountSession | null> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return null;
  }
  const requestedProvider = request.headers.get(ACCOUNT_PROVIDER_HEADER);
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.subject !== "string" ||
    !subjectPattern.test(value.user.subject) ||
    !isAccountProvider(requestedProvider) ||
    value.accountProvider !== requestedProvider ||
    !isRecord(value.smartAccount) ||
    typeof value.smartAccount.address !== "string" ||
    !addressPattern.test(value.smartAccount.address) ||
    value.smartAccount.chainId !== 8453
  ) {
    return null;
  }
  return {
    user: { subject: value.user.subject },
    smartAccount: {
      address: value.smartAccount.address.toLowerCase() as `0x${string}`,
      chainId: 8453,
    },
    accountProvider: requestedProvider,
  };
}

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

const subjectPattern = /^[a-zA-Z0-9-]{1,100}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

function isAccountProvider(value: string | null): value is AccountProvider {
  return value === "cdp-embedded" || value === "base-account";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
