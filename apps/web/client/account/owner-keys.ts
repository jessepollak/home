import type { VerifiedAccountSession } from "@/shared/account/session-types";
export { dataOwnerKey } from "@/shared/account/data-owner";

type OwnerSessionWallet = {
  ownerKey: string | null;
  session: VerifiedAccountSession | null;
};

type UiBoundaryWallet = OwnerSessionWallet & {
  status: string;
};

export function ownerSessionBoundary(wallet: OwnerSessionWallet): string | null {
  const session = wallet.session;
  return wallet.ownerKey && session?.smartAccount
    ? `${wallet.ownerKey}\u0000${session.user.subject}\u0000${session.smartAccount.address.toLowerCase()}\u0000${session.accountProvider}`
    : null;
}

export function uiBoundary(wallet: UiBoundaryWallet): string | null {
  return wallet.status === "verified" ? ownerSessionBoundary(wallet) : null;
}

export function savingsJourneyOwnerKey(session: VerifiedAccountSession): string {
  return `${session.user.subject}\u0000${session.smartAccount?.address.toLowerCase() ?? ""}\u0000${session.smartAccount?.chainId ?? ""}\u0000${session.accountProvider}`;
}

export function tradeMoneyOwnerKey(session: VerifiedAccountSession): string {
  return `${session.user.subject}:${session.smartAccount?.address ?? ""}:${session.accountProvider}`;
}

export function nativeBaseOwnerKey(session: VerifiedAccountSession): string {
  if (session.accountProvider !== "base-account" || !session.smartAccount) {
    throw new Error("Native Base authentication failed.");
  }
  return `${session.user.subject}\u0000${session.smartAccount.address}\u0000${session.smartAccount.chainId}`;
}

export function countryPreferenceOwnerKey(wallet: OwnerSessionWallet): string | null {
  return wallet.ownerKey && wallet.session
    ? `${wallet.ownerKey}\u0000${wallet.session.accountProvider}\u0000${wallet.session.user.subject}`
    : null;
}

export function savingsGrowthOwnerKey(subject: string, address: string): string {
  return `${subject}:${address.toLowerCase()}`;
}
