import { createHash, createHmac } from "node:crypto";
import { FIXED_NOW } from "./fixed-time";

const secret = "playwright-smoke-home-session-secret-32-bytes!!";
export { secret as homeSessionSecret };

export const fixtureOperatorAddress = "0x1111111111111111111111111111111111111111" as const;

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

export function cdpRenderSessionCookies(session: { user: { subject: string }; smartAccount: { address: string; chainId: number }; accountProvider: "cdp-embedded" }): Array<{ name: string; value: string }> {
  const nonce = "a".repeat(48);
  const encoded = Buffer.from(JSON.stringify({ version: 1, provider: "cdp-embedded", session, nonce,
    issuedAt: new Date(FIXED_NOW).toISOString(), expiresAt: new Date(FIXED_NOW + 100 * 365 * 24 * 60 * 60_000).toISOString(),
  })).toString("base64url");
  const input = `v1.${encoded}`;
  return [{ name: "home-cdp-session", value: `${input}.${createHmac("sha256", Buffer.from(secret)).update(input).digest("base64url")}` },
    { name: "home-cdp-live", value: nonce }];
}
