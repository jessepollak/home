import { afterAll, describe, expect, mock, test } from "bun:test";
import { createSiweMessage } from "viem/siwe";
import type { NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import {
  ACCOUNT_PROVIDER_HEADER,
  type VerifiedAccountSession,
} from "@/shared/account/session-types";
import {
  HOME_CDP_LIVE_COOKIE,
  HOME_CDP_SESSION_COOKIE,
  issueCdpRenderHint,
} from "@/server/auth/cdp-render-session";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
} from "@/server/auth/native-base-session";

const SECRET = "native-base-route-test-secret-with-32-bytes";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const ORIGIN = "https://home.example";
const previousSecret = process.env.HOME_SESSION_SECRET;
const previousProjectId = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;

process.env.HOME_SESSION_SECRET = SECRET;
process.env.NEXT_PUBLIC_CDP_PROJECT_ID = "project-with-native-session";

const CDP_SESSION: VerifiedAccountSession = {
  user: { subject: "cdp-route-test-user" },
  smartAccount: {
    address: "0x2222222222222222222222222222222222222222",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

mock.module("@/server/cdp/provider", () => ({
  getCdpAccessTokenValidator: async () => ({
    validateAccessToken: async () => ({
      userId: CDP_SESSION.user.subject,
      authenticationMethods: [{ type: "email", email: "private@example.com" }],
      evmSmartAccountObjects: [{ address: CDP_SESSION.smartAccount!.address }],
    }),
  }),
}));

const previousFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(null, { status: 503 });
  },
  { preconnect: previousFetch.preconnect },
);

const [balances, activity, borrow, trades, sessionRoute, logoutRoute] = await Promise.all([
  import("./balances/route"),
  import("./activity/route"),
  import("./borrow/route"),
  import("./trades/route"),
  import("./session/route"),
  import("./auth/base/logout/route"),
]);

afterAll(() => {
  restoreEnvironment("HOME_SESSION_SECRET", previousSecret);
  restoreEnvironment("NEXT_PUBLIC_CDP_PROJECT_ID", previousProjectId);
  globalThis.fetch = previousFetch;
  mock.restore();
});

describe("consolidated route authorization", () => {
  test("accepts valid native Base sessions and rejects invalid sessions", async () => {
    const validCookie = await createSessionCookie();
    const invalidCookie = tamper(validCookie);
    const routes = [
      {
        name: "balances",
        invoke: (cookie: string) => balances.GET(request("/api/balances?region=US", "GET", cookie)),
      },
      {
        name: "activity",
        invoke: (cookie: string) => activity.GET(request("/api/activity?to=2026-09-12T12%3A00%3A00.000Z", "GET", cookie)),
      },
      {
        name: "borrow",
        invoke: (cookie: string) => borrow.GET(request("/api/borrow", "GET", cookie)),
      },
      {
        name: "trades",
        invoke: (cookie: string) => trades.POST(request("/api/trades", "POST", cookie)),
      },
    ] as const;

    for (const route of routes) {
      const valid = await route.invoke(validCookie);
      const validBody = (await valid.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
      expect([400, 401, 403], `${route.name} valid session status ${valid.status}`).not.toContain(valid.status);
      expect(validBody?.error?.code, `${route.name} valid session boundary code`).not.toBe("AUTH_UNAVAILABLE");
      expect((await route.invoke(invalidCookie)).status, `${route.name} invalid session`).toBe(401);
    }
  });

  test("render hints have no private API authority and do not create ambiguity", async () => {
    const hintCookies = issueCdpRenderHint(
      SECRET,
      CDP_SESSION,
      new Request(`${ORIGIN}/api/session`),
    ).map(setCookiePair).join("; ");

    const privateResponse = await balances.GET(request(
      "/api/balances?region=US",
      "GET",
      hintCookies,
      "cdp-embedded",
    ));
    expect(privateResponse.status).toBe(401);

    const sessionResponse = await sessionRoute.GET(new Request(`${ORIGIN}/api/session`, {
      headers: {
        Authorization: "Bearer verified.token.value",
        Cookie: hintCookies,
        [ACCOUNT_PROVIDER_HEADER]: "cdp-embedded",
      },
    }));
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual(CDP_SESSION);
  });

  test("same-origin logout clears native and render-session cookies", async () => {
    const response = await logoutRoute.POST(new Request(`${ORIGIN}/api/auth/base/logout`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Sec-Fetch-Site": "same-origin",
      },
    }));
    expect(response.status).toBe(200);
    const cleared = response.headers.getSetCookie();
    for (const name of [
      HOME_SESSION_COOKIE,
      HOME_CHALLENGE_COOKIE,
      HOME_CDP_SESSION_COOKIE,
      HOME_CDP_LIVE_COOKIE,
    ]) {
      expect(cleared.some((value) =>
        value.startsWith(`${name}=`) && value.includes("Max-Age=0")
      ), name).toBe(true);
    }
  });
});

async function createSessionCookie(): Promise<string> {
  const dependencies = {
    sessionSecret: SECRET,
    // Routes validate expiry against the wall clock; mint relative to it.
    now: () => new Date(),
    randomId: () => "a".repeat(48),
    verify: async () => true,
  };
  const nonce = createNativeBaseNonceHandler(dependencies);
  const verify = createNativeBaseVerifyHandler(dependencies);
  const nonceResponse = await nonce(jsonRequest("/api/auth/base/nonce", {}));
  const challengeCookie = responseCookie(nonceResponse, HOME_CHALLENGE_COOKIE);
  const challenge = await nonceResponse.json() as NativeBaseChallenge;
  const message = createSiweMessage({
    ...challenge,
    address: ADDRESS,
    issuedAt: new Date(challenge.issuedAt),
    expirationTime: new Date(challenge.expirationTime),
  });
  const verifyResponse = await verify(jsonRequest(
    "/api/auth/base/verify",
    { address: ADDRESS, message, signature: "0x1234" },
    challengeCookie,
  ));
  expect(verifyResponse.status).toBe(200);
  return responseCookie(verifyResponse, HOME_SESSION_COOKIE);
}

function request(
  path: string,
  method: "GET" | "POST",
  cookie: string,
  provider = "base-account",
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      [ACCOUNT_PROVIDER_HEADER]: provider,
    },
  });
}

function jsonRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function responseCookie(response: Response, name: string): string {
  const value = response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie`);
  return value.slice(0, value.indexOf(";"));
}

function setCookiePair(value: string): string {
  return value.slice(0, value.indexOf(";"));
}

function tamper(cookie: string): string {
  const last = cookie.at(-1);
  return `${cookie.slice(0, -1)}${last === "x" ? "y" : "x"}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
