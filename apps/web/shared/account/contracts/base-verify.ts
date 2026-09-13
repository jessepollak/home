// Route contract.
// POST /api/auth/base/verify

import {
  BASE_CHAIN_ID,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export type NativeBaseVerifyRequest = {
  message: string;
  signature: `0x${string}`;
};
export type NativeBaseVerifyResponse = VerifiedAccountSession & {
  accountProvider: "base-account";
  smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]>;
};
export type NativeBaseVerifyErrorCode =
  | "AUTH_UNAVAILABLE"
  | "INVALID_AUTH_PROOF";

export function parseNativeBaseSession(value: unknown): NativeBaseVerifyResponse | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<VerifiedAccountSession>;
  if (
    session.accountProvider !== "base-account" ||
    !session.user || typeof session.user.subject !== "string" || !session.user.subject ||
    !session.smartAccount ||
    typeof session.smartAccount.address !== "string" ||
    !addressPattern.test(session.smartAccount.address) ||
    session.smartAccount.chainId !== BASE_CHAIN_ID
  ) return null;
  return {
    user: { subject: session.user.subject },
    smartAccount: {
      address: session.smartAccount.address.toLowerCase() as `0x${string}`,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider: "base-account",
  };
}
