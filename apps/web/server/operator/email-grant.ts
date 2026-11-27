import "server-only";

import { createHmac } from "node:crypto";
import { parseAddress } from "@/shared/chain/hex";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { readCdpRenderSession, type RenderCookieStore } from "@/server/auth/cdp-render-session";
import { cookie, readSignedValue, signedValue } from "@/server/auth/signed-cookie";

export const HOME_OPERATOR_GRANT_COOKIE = "home-operator-grant";
export const OPERATOR_GRANT_TTL_MS = 15 * 60_000;
const subjectPattern = /^[a-zA-Z0-9-]{1,100}$/;

type OperatorGrantPayload = {
  version: 1;
  subject: string;
  address: `0x${string}`;
  issuedAt: string;
  expiresAt: string;
};

export function requestCookieStore(request: Request): RenderCookieStore {
  return {
    getAll(name) {
      return (request.headers.get("cookie") ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.startsWith(`${name}=`))
        .map((part) => ({ value: part.slice(name.length + 1) }));
    },
  };
}

export function issueOperatorGrant(
  secretValue: string | undefined,
  session: VerifiedAccountSession,
  request: Request,
  now: Date = new Date(),
): string | null {
  const secret = secretBuffer(secretValue);
  const address = parseAddress(session.smartAccount?.address);
  if (!secret || session.accountProvider !== "cdp-embedded" || !address) return null;
  const hint = readCdpRenderSession(requestCookieStore(request), secretValue, now);
  if (!hint || hint.user.subject !== session.user.subject || hint.smartAccount?.address !== address) return null;
  const payload: OperatorGrantPayload = {
    version: 1,
    subject: session.user.subject,
    address,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OPERATOR_GRANT_TTL_MS).toISOString(),
  };
  return cookie(HOME_OPERATOR_GRANT_COOKIE, signedValue(secret, JSON.stringify(payload)), request, OPERATOR_GRANT_TTL_MS / 1000);
}

export function readOperatorGrant(
  store: RenderCookieStore,
  secretValue: string | undefined,
  now: Date = new Date(),
): VerifiedAccountSession | null {
  const secret = secretBuffer(secretValue);
  const grants = store.getAll(HOME_OPERATOR_GRANT_COOKIE);
  if (!secret || grants.length !== 1 || !grants[0]?.value) return null;
  const raw = readSignedValue(secret, grants[0].value);
  if (!raw) return null;
  const hint = readCdpRenderSession(store, secretValue, now);
  if (!hint?.smartAccount) return null;
  try {
    const payload: unknown = JSON.parse(raw);
    if (!isRecord(payload) || typeof payload.issuedAt !== "string" || typeof payload.expiresAt !== "string") return null;
    const address = parseAddress(payload.address);
    const issuedAt = Date.parse(payload.issuedAt);
    const expiresAt = Date.parse(payload.expiresAt);
    if (
      payload.version !== 1 ||
      typeof payload.subject !== "string" ||
      !subjectPattern.test(payload.subject) ||
      !address ||
      payload.subject !== hint.user.subject ||
      address !== hint.smartAccount.address ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now.getTime() ||
      expiresAt - issuedAt > OPERATOR_GRANT_TTL_MS
    ) return null;
    return {
      user: { subject: payload.subject },
      smartAccount: { address, chainId: BASE_CHAIN_ID },
      accountProvider: "cdp-embedded",
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function secretBuffer(secret: string | undefined): Buffer | null {
  const value = secret?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < 32) return null;
  return createHmac("sha256", value).update("home-operator-grant").digest();
}
