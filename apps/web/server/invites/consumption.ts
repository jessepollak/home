import "server-only";

import { clearCookie, readCookie } from "@/server/auth/signed-cookie";
import { HOME_INVITE_COOKIE, readInviteCookie } from "./cookie";

export function inviteVerifiedCookies(request: Request): string[] {
  return readCookie(request, HOME_INVITE_COOKIE).present ? [clearCookie(HOME_INVITE_COOKIE, request)] : [];
}

export function verifiedInviteCode(request: Request): string | null {
  return readInviteCookie(request);
}

export function recordVerifiedCustomer(
  request: Request,
  write: (inviteCode: string | null) => Promise<unknown>,
  recordNow: (operation: () => Promise<unknown>) => Promise<void>,
): void | Promise<void> {
  const inviteCode = verifiedInviteCode(request);
  const operation = () => write(inviteCode);
  return recordNow(operation);
}
