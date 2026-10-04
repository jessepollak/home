import * as z from "zod/mini";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";

export const NATIVE_BASE_CHALLENGE_VERSION = "1" as const;
export const NATIVE_BASE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const NATIVE_BASE_STATEMENT = "Sign in to Home." as const;

const canonicalIsoSchema = z.string().check(z.refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}));

const nativeBaseChallengeSchema = z.object({
  nonce: z.string().check(z.regex(/^[0-9a-f]{48}$/)),
  chainId: z.literal(BASE_CHAIN_ID),
  domain: z.string().check(z.minLength(1), z.maxLength(255)),
  uri: z.string().check(z.maxLength(2_048)),
  version: z.literal(NATIVE_BASE_CHALLENGE_VERSION),
  statement: z.literal(NATIVE_BASE_STATEMENT),
  issuedAt: canonicalIsoSchema,
  expirationTime: canonicalIsoSchema,
}).check(z.refine((value) => {
  if (Date.parse(value.expirationTime) - Date.parse(value.issuedAt) !== NATIVE_BASE_CHALLENGE_TTL_MS) return false;
  try {
    const uri = new URL(value.uri);
    return (uri.protocol === "http:" || uri.protocol === "https:") &&
      uri.origin === value.uri && uri.hostname === value.domain;
  } catch {
    return false;
  }
}));

export type NativeBaseChallenge = z.output<typeof nativeBaseChallengeSchema>;

export function parseNativeBaseChallenge(value: unknown): NativeBaseChallenge | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 8) return null;
  const result = nativeBaseChallengeSchema.safeParse(value);
  return result.success ? result.data : null;
}
