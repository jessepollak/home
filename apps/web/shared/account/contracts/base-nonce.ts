// Route contract.
// POST /api/auth/base/nonce

import { BASE_CHAIN_ID } from "@/shared/account/session-types";

export const NATIVE_BASE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const NATIVE_BASE_STATEMENT = "Sign in to Home." as const;

export type NativeBaseNonceRequest = Record<string, never>;
export type NativeBaseChallenge = {
  nonce: string;
  chainId: typeof BASE_CHAIN_ID;
  domain: string;
  uri: string;
  version: "1";
  statement: typeof NATIVE_BASE_STATEMENT;
  issuedAt: string;
  expirationTime: string;
};
export type NativeBaseNonceResponse = NativeBaseChallenge;
export type NativeBaseNonceErrorCode = "AUTH_UNAVAILABLE" | "INVALID_REQUEST";

const challengeKeys = [
  "nonce",
  "chainId",
  "domain",
  "uri",
  "version",
  "statement",
  "issuedAt",
  "expirationTime",
] as const;

function canonicalIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return value;
}

export function parseNativeBaseChallenge(value: unknown): NativeBaseChallenge | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== challengeKeys.length ||
    challengeKeys.some((key) => !(key in record)) ||
    typeof record.nonce !== "string" || !/^[0-9a-f]{48}$/.test(record.nonce) ||
    record.chainId !== BASE_CHAIN_ID ||
    typeof record.domain !== "string" || !record.domain || record.domain.length > 255 ||
    typeof record.uri !== "string" || record.uri.length > 2_048 ||
    record.version !== "1" ||
    record.statement !== NATIVE_BASE_STATEMENT
  ) return null;

  const issuedAt = canonicalIso(record.issuedAt);
  const expirationTime = canonicalIso(record.expirationTime);
  if (!issuedAt || !expirationTime) return null;
  if (Date.parse(expirationTime) - Date.parse(issuedAt) !== NATIVE_BASE_CHALLENGE_TTL_MS) return null;

  try {
    const uri = new URL(record.uri);
    if (
      (uri.protocol !== "http:" && uri.protocol !== "https:") ||
      uri.origin !== record.uri ||
      uri.host !== record.domain
    ) return null;
  } catch {
    return null;
  }

  return {
    nonce: record.nonce,
    chainId: BASE_CHAIN_ID,
    domain: record.domain,
    uri: record.uri,
    version: "1",
    statement: NATIVE_BASE_STATEMENT,
    issuedAt,
    expirationTime,
  };
}

export const parseNativeBaseNonceResponse = parseNativeBaseChallenge;
