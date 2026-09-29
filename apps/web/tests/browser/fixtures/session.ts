import { createHash, createHmac } from "node:crypto";
import { FIXED_NOW } from "./fixed-time";

const secret = "playwright-smoke-home-session-secret-32-bytes!!";

export function homeSessionToken(address: string): string {
  const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
  const now = FIXED_NOW;
  const encoded = Buffer.from(JSON.stringify({
    version: 1,
    session: {
      user: { subject },
      smartAccount: { address, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 100 * 365 * 24 * 60 * 60_000).toISOString(),
  })).toString("base64url");
  const input = `v1.${encoded}`;
  return `${input}.${createHmac("sha256", Buffer.from(secret)).update(input).digest("base64url")}`;
}
