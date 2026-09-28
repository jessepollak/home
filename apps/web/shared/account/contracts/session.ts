
import {
  BASE_CHAIN_ID,

  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import { parseAddress } from "@/shared/chain/hex";

export type SessionResponse = VerifiedAccountSession;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const parsedAddress = parseAddress(address);
  if (!parsedAddress || chainId !== BASE_CHAIN_ID) {
    return null;
  }

  return {
    user: { subject },
    smartAccount: {
      address: parsedAddress,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider,
  };
}
