import "server-only";

import { createHmac } from "node:crypto";
import { readSignedValue, signedValue } from "@/server/auth/signed-cookie";

export const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SIGNING_KEY_LABEL = "home:deployment-access:v1:signing-key";

type AccessTokenPayload = {
  version: 1;
  issuedAt: string;
  expiresAt: string;
};

export type AccessTokenSigner = {
  credential: string;
  signingSecret: string;
};

function signingKey(signer: AccessTokenSigner): Buffer {
  return createHmac("sha256", Buffer.from(signer.signingSecret, "utf8"))
    .update(SIGNING_KEY_LABEL)
    .update("\0")
    .update(signer.credential, "utf8")
    .digest();
}

export function issueAccessToken(signer: AccessTokenSigner, now = new Date()): string {
  const payload: AccessTokenPayload = {
    version: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString(),
  };
  return signedValue(signingKey(signer), JSON.stringify(payload));
}

export function readAccessToken(
  token: string,
  signer: AccessTokenSigner,
  now = new Date(),
): AccessTokenPayload | null {
  const value = readSignedValue(signingKey(signer), token);
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as Partial<AccessTokenPayload>;
    const issuedAt = Date.parse(payload.issuedAt ?? "");
    const expiresAt = Date.parse(payload.expiresAt ?? "");
    if (
      payload.version !== 1 ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      new Date(issuedAt).toISOString() !== payload.issuedAt ||
      new Date(expiresAt).toISOString() !== payload.expiresAt ||
      issuedAt > now.getTime() ||
      expiresAt <= now.getTime() ||
      expiresAt - issuedAt !== ACCESS_TOKEN_TTL_MS
    ) return null;
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}
