import { parseAddress, type Address } from "@/shared/chain/hex";

import {
  BASE_CHAIN_ID,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";


export type NativeBaseVerifyResponse = VerifiedAccountSession & {
  accountProvider: "base-account";
  smartAccount: NonNullable<VerifiedAccountSession["smartAccount"]> & { address: Address };
};
export function parseNativeBaseSession(value: unknown): NativeBaseVerifyResponse | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<VerifiedAccountSession>;
  const address = parseAddress(session.smartAccount?.address);
  if (
    session.accountProvider !== "base-account" ||
    !session.user || typeof session.user.subject !== "string" || !session.user.subject ||
    !session.smartAccount ||
    !address ||
    session.smartAccount.chainId !== BASE_CHAIN_ID
  ) return null;
  return {
    user: { subject: session.user.subject },
    smartAccount: {
      address,
      chainId: BASE_CHAIN_ID,
    },
    accountProvider: "base-account",
  };
}
