import "server-only";

import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import { BASE_CHAIN_ID, OWNER_SESSION_RETENTION_MS, type VerifiedAccountSession } from "@/shared/account/session-types";
import { cookie, equalText, readSignedValue, signedValue } from "@/server/auth/signed-cookie";

export const HOME_CDP_SESSION_COOKIE = "home-cdp-session";
export const HOME_CDP_LIVE_COOKIE = "home-cdp-live";
const CDP_RENDER_SESSION_TTL_MS = OWNER_SESSION_RETENTION_MS;
const CDP_RENDER_SESSION_MAX_AGE = CDP_RENDER_SESSION_TTL_MS / 1000;
const subjectPattern = /^[a-zA-Z0-9-]{1,100}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const noncePattern = /^[0-9a-f]{48}$/;

export type RenderCookieStore = {
  getAll(name: string): Array<{ value: string }>;
};

type CdpRenderPayload = {
  version: 1;
  provider: "cdp-embedded";
  session: VerifiedAccountSession;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export function issueCdpRenderHint(
  secretValue: string | undefined,
  session: VerifiedAccountSession,
  request: Request,
  now: Date = new Date(),
): string[] {
  const secret = secretBuffer(secretValue);
  if (!secret) return [];
  const nonce = randomBytes(24).toString("hex");
  const payload: CdpRenderPayload = {
    version: 1,
    provider: "cdp-embedded",
    session,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CDP_RENDER_SESSION_TTL_MS).toISOString(),
  };
  return [
    cookie(
      HOME_CDP_SESSION_COOKIE,
      signedValue(secret, JSON.stringify(payload)),
      request,
      CDP_RENDER_SESSION_MAX_AGE,
    ),
    cookie(
      HOME_CDP_LIVE_COOKIE,
      nonce,
      request,
      CDP_RENDER_SESSION_MAX_AGE,
      { httpOnly: false },
    ),
  ];
}

export function readCdpRenderSession(
  cookies: RenderCookieStore,
  secretValue: string | undefined,
  now: Date = new Date(),
): VerifiedAccountSession | null {
  const secret = secretBuffer(secretValue);
  const signedCookies = cookies.getAll(HOME_CDP_SESSION_COOKIE);
  const liveCookies = cookies.getAll(HOME_CDP_LIVE_COOKIE);
  if (!secret || signedCookies.length !== 1 || liveCookies.length !== 1) return null;
  const token = signedCookies[0]?.value;
  const live = liveCookies[0]?.value;
  if (!token || !live) return null;
  const raw = readSignedValue(secret, token);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as CdpRenderPayload;
    const address = normalizeAddress(payload?.session?.smartAccount?.address);
    if (
      payload.version !== 1 ||
      payload.provider !== "cdp-embedded" ||
      payload.session.accountProvider !== "cdp-embedded" ||
      payload.session.smartAccount?.chainId !== BASE_CHAIN_ID ||
      !address ||
      !subjectPattern.test(payload.session.user.subject) ||
      !noncePattern.test(payload.nonce) ||
      !equalText(live, payload.nonce) ||
      !Number.isFinite(Date.parse(payload.issuedAt)) ||
      !Number.isFinite(Date.parse(payload.expiresAt)) ||
      Date.parse(payload.expiresAt) <= now.getTime()
    ) return null;

    return {
      user: { subject: payload.session.user.subject },
      smartAccount: { address, chainId: BASE_CHAIN_ID },
      accountProvider: "cdp-embedded",
    };
  } catch {
    return null;
  }
}

function secretBuffer(secret: string | undefined): Buffer | null {
  const value = secret?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < 32) return null;
  return Buffer.from(value, "utf8");
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !addressPattern.test(value)) return null;
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}
