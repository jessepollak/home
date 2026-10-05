import "server-only";

import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { readCdpCredentials } from "@/server/config/env";

export type CdpJwtGenerator = typeof generateJwt;
type Environment = Readonly<Record<string, string | undefined>>;

export type CdpAuthErrorCode = "not-configured" | "signing-failed" | "malformed-token";

export class CdpAuthError extends Error {
  constructor(
    readonly code: CdpAuthErrorCode,
    readonly tokenIssue?: "missing" | "whitespace",
  ) {
    super({
      "not-configured": "CDP API credentials are not configured.",
      "signing-failed": "CDP request signing failed.",
      "malformed-token": "CDP request signing returned a malformed token.",
    }[code]);
    this.name = "CdpAuthError";
  }
}

export async function signCdpRequest({
  method,
  host,
  path,
  expiresIn = 120,
  env,
  generateJwtImpl = generateJwt,
}: {
  method: string;
  host: string;
  path: string;
  expiresIn?: number;
  env?: Environment;
  generateJwtImpl?: CdpJwtGenerator;
}): Promise<{ token: string; authorization: string }> {
  const credentials = readCdpCredentials(env);
  if (credentials.status !== "complete") throw new CdpAuthError("not-configured");
  let token: string;
  try {
    token = await generateJwtImpl({
      apiKeyId: credentials.apiKeyId,
      apiKeySecret: credentials.apiKeySecret,
      requestMethod: method,
      requestHost: host,
      requestPath: path,
      expiresIn,
    });
  } catch {
    throw new CdpAuthError("signing-failed");
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new CdpAuthError("malformed-token", "missing");
  }
  if (/\s/.test(token)) throw new CdpAuthError("malformed-token", "whitespace");
  return { token, authorization: `Bearer ${token}` };
}
