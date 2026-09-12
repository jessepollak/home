import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Quote } from "@/shared/funding/provider-contract";

export type FundingQuoteClaims = {
  subject: string;
  accountProvider: "cdp-embedded" | "base-account";
  providerId: string;
  region: string;
  paymentMethod: string;
  destination: `0x${string}`;
  assetId: string;
  fiatAmount: string;
  quote: Quote;
  customerRef: string | null;
};

export type AuthenticatedFundingQuote = {
  claims: FundingQuoteClaims;
  canonicalToken: string;
};

export function signFundingQuote(claims: FundingQuoteClaims, secret: string): string {
  requireSecret(secret);
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function authenticateFundingQuote(token: string, secret: string): AuthenticatedFundingQuote | null {
  try {
    requireSecret(secret);
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || payload.length > 16_384) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const payloadBytes = Buffer.from(payload, "base64url");
    const supplied = Buffer.from(signature, "base64url");
    if (payloadBytes.toString("base64url") !== payload || supplied.toString("base64url") !== signature) return null;
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const claims = JSON.parse(payloadBytes.toString("utf8")) as unknown;
    if (!validClaims(claims)) return null;
    return { claims, canonicalToken: `${payload}.${signature}` };
  } catch { return null; }
}

export function verifyFundingQuote(token: string, secret: string, now = Date.now()): FundingQuoteClaims | null {
  const authenticated = authenticateFundingQuote(token, secret);
  return authenticated && !isFundingQuoteExpired(authenticated.claims, now)
    ? authenticated.claims
    : null;
}

export function isFundingQuoteExpired(claims: FundingQuoteClaims, now = Date.now()): boolean {
  return Date.parse(claims.quote.expiresAt) <= now;
}

function validClaims(value: unknown): value is FundingQuoteClaims {
  if (!record(value) || !record(value.quote)) return false;
  return typeof value.subject === "string" && value.subject.length > 0
    && (value.accountProvider === "cdp-embedded" || value.accountProvider === "base-account")
    && ["providerId", "region", "paymentMethod", "assetId", "fiatAmount"].every((key) => typeof value[key] === "string" && value[key].length > 0)
    && typeof value.destination === "string" && /^0x[0-9a-f]{40}$/.test(value.destination)
    && (value.customerRef === null || typeof value.customerRef === "string")
    && typeof value.quote.fiatAmount === "string"
    && typeof value.quote.tokenAmountAtomic === "string" && /^(0|[1-9][0-9]*)$/.test(value.quote.tokenAmountAtomic)
    && Array.isArray(value.quote.fees)
    && typeof value.quote.expiresAt === "string" && Number.isFinite(Date.parse(value.quote.expiresAt));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireSecret(secret: string) { if (secret.trim().length < 32) throw new Error("FUNDING_QUOTE_SECRET must contain at least 32 characters"); }
