import {
  createBlockedAccountWalletClient,
  type AccountWalletClient,
} from "@/client/account/cdp-client";

export function verifiedAccountWalletClient({
  accountProvider = "cdp-embedded",
  owner = "a",
  address,
}: {
  accountProvider?: "cdp-embedded" | "base-account";
  owner?: string;
  address?: `0x${string}`;
} = {}): AccountWalletClient {
  return {
    ...createBlockedAccountWalletClient("unconfigured"),
    projectConfigured: true,
    signInAvailability: "ready",
    ownerKey: `owner-${owner}`,
    status: "verified",
    session: {
      user: { subject: `subject-${owner}` },
      smartAccount: {
        address: address ?? (owner === "a"
          ? "0x1111111111111111111111111111111111111111"
          : "0x2222222222222222222222222222222222222222"),
        chainId: 8453,
      },
      accountProvider,
    },
  };
}
