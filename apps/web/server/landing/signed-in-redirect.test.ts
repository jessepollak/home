import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { signedValue } from "@/server/auth/native-base-session";
import { signedInLandingHref } from "./signed-in-redirect";

const SECRET = "landing-redirect-test-session-secret";
const ENV = { HOME_SESSION_SECRET: SECRET };
const NOW = new Date("2026-01-01T00:00:00Z");
const ADDRESS = "0x1111111111111111111111111111111111111111";

function signedHomeSessionCookie(expiresAt = new Date(NOW.getTime() + 60_000)): string {
  return signedValue(Buffer.from(SECRET), JSON.stringify({
    version: 1,
    session: {
      user: {
        subject: `base-${createHash("sha256").update(ADDRESS).digest("hex").slice(0, 32)}`,
      },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    },
    issuedAt: NOW.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }));
}

function cookieStore(token?: string): RequestCookies {
  const cookies = new RequestCookies(new Headers());
  if (token) cookies.set("home-session", token);
  return cookies;
}

describe("signed-in landing redirect", () => {
  test("signed session at / redirects to /home", () => {
    expect(signedInLandingHref({}, cookieStore(signedHomeSessionCookie()), ENV, NOW)).toBe("/home");
  });

  test("signed session retains only the flow overlay", () => {
    expect(signedInLandingHref(
      { flow: "send", panel: "balances", group: "investments" },
      cookieStore(signedHomeSessionCookie()), ENV, NOW,
    )).toBe("/home?flow=send");
  });

  test("signed session at /?account=signin stays at the landing", () => {
    expect(signedInLandingHref({ account: "signin" }, cookieStore(signedHomeSessionCookie()), ENV, NOW)).toBeNull();
  });

  test("signed-out / stays at the landing", () => {
    expect(signedInLandingHref({}, cookieStore(), ENV, NOW)).toBeNull();
  });

  test("tampered signature at / does not redirect", () => {
    const token = signedHomeSessionCookie();
    const signatureStart = token.lastIndexOf(".") + 1;
    const middle = signatureStart + Math.floor((token.length - signatureStart) / 2);
    const tampered = `${token.slice(0, middle)}${token[middle] === "a" ? "b" : "a"}${token.slice(middle + 1)}`;
    expect(signedInLandingHref({}, cookieStore(tampered), ENV, NOW)).toBeNull();
  });

  test("expired session at / does not redirect", () => {
    expect(signedInLandingHref({}, cookieStore(signedHomeSessionCookie(NOW)), ENV, NOW)).toBeNull();
  });
});
