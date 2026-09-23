
import {
  BASE_CHAIN_ID,

  type VerifiedAccountSession,
} from "@/shared/account/session-types";

export type SessionResponse = VerifiedAccountSession;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAddress(value: string): `0x${string}` {
  return value.toLowerCase() as `0x${string}`;
}

export function parseSession(value: unknown): SessionResponse | null {
  if (!isRecord(value) || !isRecord(value.user)) {
    return null;
  }

  const subject = value.user.subject;
  if (typeof subject !== "string" || subject.trim().length === 0) {
    return null;
  }

  const accountProvider = value.accountProvider;
  if (
    accountProvider !== "cdp-embedded" &&
    accountProvider !== "base-account"
  ) {
    return null;
  }

  if (value.smartAccount === null) {
    if (accountProvider === "base-account") {
      return null;
    }
    return {
      user: { subject },
      smartAccount: null,
      accountProvider,
    };
  }

  if (!isRecord(value.smartAccount)) {
    return null;
  }

  const { address, chainId } = value.smartAccount;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    chainId !== BASE_CHAIN_ID
  ) {
    return null;
  }

  return {
    user: { subject },
    smartAccount: {
      address: normalizeAddress(address),
      chainId: BASE_CHAIN_ID,
    },
    accountProvider,
  };
}
