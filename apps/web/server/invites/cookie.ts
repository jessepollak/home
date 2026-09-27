import "server-only";

import { createHmac } from "node:crypto";
import { isInviteCode } from "@/shared/invites/contract";
import { cookie, readCookie, readSignedValue, signedValue } from "@/server/auth/signed-cookie";

export const HOME_INVITE_COOKIE = "home_invite";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function inviteSecret(secretValue: string | undefined): Buffer | null {
  const secret = secretValue?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return null;
  return createHmac("sha256", secret).update("home-invite").digest();
}

export function issueInviteCookie(request: Request, code: string, now: Date = new Date(), secretValue = process.env.HOME_SESSION_SECRET): string | null {
  const secret = inviteSecret(secretValue);
  if (!secret || !isInviteCode(code)) return null;
  return cookie(HOME_INVITE_COOKIE, signedValue(secret, `${code}:${Math.floor(now.getTime() / 1000)}`), request, MAX_AGE_SECONDS);
}

export function readInviteCookie(request: Request, now: Date = new Date(), secretValue = process.env.HOME_SESSION_SECRET): string | null {
  const secret = inviteSecret(secretValue);
  const token = readCookie(request, HOME_INVITE_COOKIE).value;
  if (!secret || !token) return null;
  const raw = readSignedValue(secret, token);
  const match = raw && /^([a-z2-9]{10}):([0-9]+)$/.exec(raw);
  if (!match || !isInviteCode(match[1])) return null;
  const age = Math.floor(now.getTime() / 1000) - Number(match[2]);
  return Number.isSafeInteger(age) && age >= 0 && age <= MAX_AGE_SECONDS ? match[1] : null;
}
