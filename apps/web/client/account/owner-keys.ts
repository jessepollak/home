import type { VerifiedAccountSession } from "@/shared/account/session-types";

type DataOwnerSession =
  | VerifiedAccountSession
  | {
      subject: string;
      smartAccountAddress: `0x${string}`;
      chainId: number;
      accountProvider?: string;
    };

type OwnerSessionWallet = {
  ownerKey: string | null;
  session: VerifiedAccountSession | null;
};

type UiBoundaryWallet = OwnerSessionWallet & {
  status: string;
};

export function dataOwnerKey(session: DataOwnerSession): string {
  const subject = "user" in session ? session.user.subject : session.subject;
  const address = "smartAccount" in session
    ? session.smartAccount?.address
    : session.smartAccountAddress;
  const chainId = "smartAccount" in session
    ? session.smartAccount?.chainId
    : session.chainId;
  const provider = session.accountProvider;
  if (!address || !chainId) {
    throw new Error("A verified smart account is required for an owner key.");
  }
  const base = `${subject}\u0000${address.toLowerCase()}\u0000${chainId}`;
  return provider ? `${base}\u0000${provider}` : base;
}

export function ownerSessionBoundary(wallet: OwnerSessionWallet): string | null {
  const session = wallet.session;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.accountProvider}`
    : null;
}

export function uiBoundary(wallet: UiBoundaryWallet): string | null {
  return wallet.status === "verified" ? ownerSessionBoundary(wallet) : null;
}
