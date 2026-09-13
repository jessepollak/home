import type { VerifiedAccountSession } from "@/shared/account/session-types";

export function verifiedSession({
  subject = "subject-a",
  address = "0x1111111111111111111111111111111111111111",
  accountProvider = "cdp-embedded",
}: {
  subject?: string;
  address?: `0x${string}`;
  accountProvider?: VerifiedAccountSession["accountProvider"];
} = {}): VerifiedAccountSession {
  return {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider,
  };
}
