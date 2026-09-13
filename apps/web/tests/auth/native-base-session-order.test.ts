import "@/client/account/dom-test-harness";

import { describe, expect, test } from "bun:test";
import { createSiweMessage } from "viem/siwe";
import type { NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import { HOME_CDP_LIVE_COOKIE, HOME_CDP_SESSION_COOKIE } from "@/server/auth/cdp-render-session";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  createNativeBaseLogoutHandler,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
} from "@/server/auth/native-base-session";

const SECRET = "shared-process-auth-test-secret-with-32-bytes";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ORIGIN = "https://home.example";
const NOW = new Date("2026-09-12T12:00:00.000Z");

function request(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookiePair(header: string): string {
  return header.slice(0, header.indexOf(";"));
}

describe("native Base authentication after shared DOM setup", () => {
  test("preserves separate secure server cookies in the contaminated-process order", async () => {
    expect(typeof document).toBe("object");

    const dependencies = {
      sessionSecret: SECRET,
      now: () => NOW,
      randomId: () => "b".repeat(48),
      verify: async () => true,
    };
    const nonce = createNativeBaseNonceHandler(dependencies);
    const verify = createNativeBaseVerifyHandler(dependencies);

    const nonceResponse = await nonce(request("/api/auth/base/nonce", {}));
    expect(nonceResponse.status).toBe(200);
    const challengeCookies = nonceResponse.headers.getSetCookie();
    expect(challengeCookies).toHaveLength(1);
    expect(challengeCookies[0]).toContain(`${HOME_CHALLENGE_COOKIE}=`);
    expect(challengeCookies[0]).toContain("HttpOnly");
    expect(challengeCookies[0]).toContain("Secure");
    expect(challengeCookies[0]).toContain("SameSite=Lax");

    const challenge = await nonceResponse.json() as NativeBaseChallenge;
    const message = createSiweMessage({
      ...challenge,
      address: ADDRESS,
      issuedAt: new Date(challenge.issuedAt),
      expirationTime: new Date(challenge.expirationTime),
    });
    const verifyResponse = await verify(request(
      "/api/auth/base/verify",
      { address: ADDRESS, message, signature: "0x1234" },
      cookiePair(challengeCookies[0]!),
    ));
    expect(verifyResponse.status).toBe(200);
    const sessionCookies = verifyResponse.headers.getSetCookie();
    expect(sessionCookies).toHaveLength(2);
    expect(sessionCookies.some((value) => value.startsWith(`${HOME_SESSION_COOKIE}=`))).toBe(true);
    expect(sessionCookies.every((value) => value.includes("HttpOnly"))).toBe(true);
    expect(sessionCookies.every((value) => value.includes("Secure"))).toBe(true);
    expect(sessionCookies.every((value) => value.includes("SameSite=Lax"))).toBe(true);

    const logoutResponse = await createNativeBaseLogoutHandler()(
      new Request(`${ORIGIN}/api/auth/base/logout`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
      }),
    );
    const logoutCookies = logoutResponse.headers.getSetCookie();
    expect(logoutCookies).toHaveLength(4);
    for (const name of [
      HOME_SESSION_COOKIE,
      HOME_CHALLENGE_COOKIE,
      HOME_CDP_SESSION_COOKIE,
      HOME_CDP_LIVE_COOKIE,
    ]) {
      expect(logoutCookies.some((value) => value.startsWith(`${name}=`)), name).toBe(true);
    }
    expect(logoutCookies.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });
});
