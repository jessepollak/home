import { describe, expect, test } from "bun:test";
import { createSiweMessage } from "viem/siwe";
import type { NativeBaseChallenge } from "@/shared/account/contracts/base-nonce";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  NATIVE_BASE_NONCE_TTL_MS,
  createNativeBaseLogoutHandler,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
  readNativeBaseSession,
  readNativeBaseSessionToken,
  signedValue,
} from "./native-base-session";

const SECRET = "test-home-session-secret-that-is-long-enough";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const ORIGIN = "http://127.0.0.1:3103";
const START = new Date("2026-09-12T12:00:00.000Z");
const NONCE = "a".repeat(48);

function post(
  path: string,
  body: unknown,
  cookie?: string,
  origin = ORIGIN,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function logoutRequest(headers: Record<string, string> = {}): Request {
  return post("/api/auth/base/logout", {}, undefined, ORIGIN, headers);
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.get("set-cookie") ||
    response.headers.getSetCookie().join(",") || "";
  const match = new RegExp(`${name}=([^;,]+)`).exec(header);
  if (!match?.[1]) throw new Error(`Missing ${name} cookie`);
  return `${name}=${match[1]}`;
}

function handlers(now = () => START, verifySignature = async () => true) {
  const dependencies = {
    sessionSecret: SECRET,
    now,
    randomId: () => NONCE,
    verify: verifySignature,
  };
  return {
    nonce: createNativeBaseNonceHandler(dependencies),
    verify: createNativeBaseVerifyHandler(dependencies),
  };
}

function messageFor(
  challenge: NativeBaseChallenge,
  address: `0x${string}` = ADDRESS,
  overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {},
): string {
  return createSiweMessage({
    ...challenge,
    address,
    issuedAt: new Date(challenge.issuedAt),
    expirationTime: new Date(challenge.expirationTime),
    ...overrides,
  });
}

async function challenge(
  nonce: ReturnType<typeof createNativeBaseNonceHandler>,
): Promise<{ challenge: NativeBaseChallenge; message: string; cookie: string }> {
  const response = await nonce(post("/api/auth/base/nonce", {}));
  expect(response.status).toBe(200);
  const payload = await response.json() as NativeBaseChallenge;
  return {
    challenge: payload,
    message: messageFor(payload),
    cookie: cookieValue(response, HOME_CHALLENGE_COOKIE),
  };
}

function verifyBody(message: string, address: `0x${string}` = ADDRESS) {
  return { address, message, signature: "0x1234" };
}

describe("native Base authentication handlers", () => {
  test("requires HOME_SESSION_SECRET and an address-independent empty challenge request", async () => {
    const nonce = createNativeBaseNonceHandler({
      sessionSecret: "short",
      now: () => START,
      randomId: () => NONCE,
    });
    expect((await nonce(post("/api/auth/base/nonce", {}))).status).toBe(503);

    const configured = handlers().nonce;
    expect((await configured(post("/api/auth/base/nonce", { address: ADDRESS }))).status).toBe(400);
    const issued = await challenge(configured);
    expect(issued.challenge).toEqual({
      nonce: NONCE,
      chainId: 8453,
      domain: "127.0.0.1:3103",
      uri: ORIGIN,
      version: "1",
      statement: "Sign in to Home.",
      issuedAt: START.toISOString(),
      expirationTime: new Date(START.getTime() + NATIVE_BASE_NONCE_TTL_MS).toISOString(),
    });
  });

  test("establishes a signed HttpOnly session from the exact issued fields and body address", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const verified = await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      issued.cookie,
    ));
    expect(verified.status).toBe(200);
    const setCookies = verified.headers.getSetCookie();
    expect(setCookies.some((value) => value.startsWith(`${HOME_CHALLENGE_COOKIE}=`) && value.includes("Max-Age=0"))).toBe(true);
    expect(setCookies.some((value) => value.startsWith(`${HOME_SESSION_COOKIE}=`))).toBe(true);
    expect(setCookies.every((value) => value.includes("HttpOnly"))).toBe(true);
    expect(await verified.json()).toEqual({
      user: { subject: expect.stringMatching(/^base-[0-9a-f]{32}$/) },
      smartAccount: { address: ADDRESS, chainId: 8453 },
      accountProvider: "base-account",
    });
  });

  test("returns a cleared 401 when canonical rendering rejects the issued host", async () => {
    const invalidOrigin = "http://foo+bar";
    const { nonce, verify } = handlers();
    const nonceResponse = await nonce(post("/api/auth/base/nonce", {}, undefined, invalidOrigin));
    expect(nonceResponse.status).toBe(200);
    const issued = await nonceResponse.json() as NativeBaseChallenge;
    const message = `${issued.domain} wants you to sign in with your Ethereum account:\n${ADDRESS}\n\n${issued.statement}\n\nURI: ${issued.uri}\nVersion: ${issued.version}\nChain ID: ${issued.chainId}\nNonce: ${issued.nonce}\nIssued At: ${issued.issuedAt}\nExpiration Time: ${issued.expirationTime}`;

    const response = await verify(post(
      "/api/auth/base/verify",
      verifyBody(message),
      cookieValue(nonceResponse, HOME_CHALLENGE_COOKIE),
      invalidOrigin,
    ));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "INVALID_AUTH_PROOF" } });
    expect(response.headers.getSetCookie().some((value) =>
      value.startsWith(`${HOME_CHALLENGE_COOKIE}=`) && value.includes("Max-Age=0")
    )).toBe(true);
  });

  test("requires normalized body address to equal the parsed SIWE address", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message, OTHER_ADDRESS),
      issued.cookie,
    ))).status).toBe(401);
    expect((await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ))).status).toBe(401);
  });

  test("rejects every changed issued field and every unissued SIWE extra", async () => {
    const cases: Array<[string, (issued: Awaited<ReturnType<typeof challenge>>) => string]> = [
      ["chain", (issued) => messageFor(issued.challenge, ADDRESS, { chainId: 1 })],
      ["domain", (issued) => messageFor(issued.challenge, ADDRESS, { domain: "evil.example" })],
      ["uri", (issued) => messageFor(issued.challenge, ADDRESS, { uri: "https://evil.example" })],
      ["nonce", (issued) => messageFor(issued.challenge, ADDRESS, { nonce: "b".repeat(48) })],
      ["version", (issued) => issued.message.replace("Version: 1", "Version: 2")],
      ["statement", (issued) => messageFor(issued.challenge, ADDRESS, { statement: "Different." })],
      ["issuedAt", (issued) => messageFor(issued.challenge, ADDRESS, { issuedAt: new Date(START.getTime() + 1_000) })],
      ["expirationTime", (issued) => messageFor(issued.challenge, ADDRESS, { expirationTime: new Date(START.getTime() + 60_000) })],
      ["notBefore", (issued) => messageFor(issued.challenge, ADDRESS, { notBefore: START })],
      ["requestId", (issued) => messageFor(issued.challenge, ADDRESS, { requestId: "unissued" })],
      ["resources", (issued) => messageFor(issued.challenge, ADDRESS, { resources: ["https://home.example/resource"] })],
      ["scheme", (issued) => messageFor(issued.challenge, ADDRESS, { scheme: "https" })],
      ["trailing field", (issued) => `${issued.message}\nUnexpected: value`],
    ];
    for (const [name, mutate] of cases) {
      const { nonce, verify } = handlers();
      const issued = await challenge(nonce);
      const message = mutate(issued);
      expect((await verify(post(
        "/api/auth/base/verify",
        verifyBody(message),
        issued.cookie,
      ))).status, name).toBe(401);
    }

    const matchingScheme = handlers();
    const issued = await challenge(matchingScheme.nonce);
    expect((await matchingScheme.verify(post(
      "/api/auth/base/verify",
      verifyBody(messageFor(issued.challenge, ADDRESS, { scheme: "http" })),
      issued.cookie,
    ))).status).toBe(200);
  });

  test("accepts an unexpired signed challenge when the verifier clock trails the issuer", async () => {
    let current = new Date(START.getTime() + 1_000);
    const { nonce, verify } = handlers(() => current);
    const issued = await challenge(nonce);
    current = START;

    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      issued.cookie,
    ))).status).toBe(200);
  });

  test("rejects challenge cookie v1, wrong TTL, expiry, and tampering", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const legacy = signedValue(Buffer.from(SECRET), JSON.stringify({
      version: 1,
      origin: ORIGIN,
      challenge: issued.challenge,
    }));
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      `${HOME_CHALLENGE_COOKIE}=${legacy}`,
    ))).status).toBe(401);

    const wrongTtlChallenge = {
      ...issued.challenge,
      expirationTime: new Date(START.getTime() + 60_000).toISOString(),
    };
    const wrongTtl = signedValue(Buffer.from(SECRET), JSON.stringify({
      version: 2,
      origin: ORIGIN,
      challenge: wrongTtlChallenge,
    }));
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(messageFor(wrongTtlChallenge)),
      `${HOME_CHALLENGE_COOKIE}=${wrongTtl}`,
    ))).status).toBe(401);

    let current = START;
    const expiring = handlers(() => current);
    const expired = await challenge(expiring.nonce);
    current = new Date(START.getTime() + NATIVE_BASE_NONCE_TTL_MS + 1);
    expect((await expiring.verify(post(
      "/api/auth/base/verify",
      verifyBody(expired.message),
      expired.cookie,
    ))).status).toBe(401);

    const tamperedCookie = `${issued.cookie.slice(0, -1)}x`;
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      tamperedCookie,
    ))).status).toBe(401);
  });

  // Stateless challenge: single-use is enforced by the browser dropping the cookie plus the TTL.
  test("rejects a replayed verify once the browser has dropped the challenge cookie", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      issued.cookie,
    ))).status).toBe(200);
    expect((await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
    ))).status).toBe(401);
  });

  test("rejects invalid signatures and upstream verification failures", async () => {
    const cases = [
      { verifySignature: async () => false, status: 401 },
      { verifySignature: async () => { throw new Error("rpc unavailable"); }, status: 503 },
    ];
    for (const entry of cases) {
      const { nonce, verify } = handlers(() => START, entry.verifySignature);
      const issued = await challenge(nonce);
      const response = await verify(post(
        "/api/auth/base/verify",
        verifyBody(issued.message),
        issued.cookie,
      ));
      expect(response.status).toBe(entry.status);
    }
  });

  test("logout requires same-origin POST and clears all authentication cookies", async () => {
    const logout = createNativeBaseLogoutHandler();
    expect((await logout(logoutRequest())).status).toBe(403);
    expect((await logout(logoutRequest({ Origin: "https://evil.example" }))).status).toBe(403);

    const response = await logout(logoutRequest({
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    }));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });

  test("reads only valid signed Base sessions and rejects cookie tampering", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const response = await verify(post(
      "/api/auth/base/verify",
      verifyBody(issued.message),
      issued.cookie,
    ));
    const sessionCookie = cookieValue(response, HOME_SESSION_COOKIE);
    const session = await response.json();
    const malformedExpiry = signedValue(Buffer.from(SECRET), JSON.stringify({
      version: 1,
      session,
      issuedAt: START.toISOString(),
      expiresAt: "not-a-date",
    }));
    const cases = [
      {
        name: "valid session",
        read: () => readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
          headers: { Cookie: sessionCookie },
        }), SECRET, START),
        expected: "valid",
      },
      {
        name: "tampered session",
        read: () => readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
          headers: { Cookie: `${sessionCookie.slice(0, -1)}x` },
        }), SECRET, START),
        expected: "invalid",
      },
      {
        name: "malformed expiry",
        read: () => readNativeBaseSessionToken(malformedExpiry, SECRET, START),
        expected: "invalid",
      },
    ] as const;

    for (const entry of cases) {
      expect(entry.read().kind, entry.name).toBe(entry.expected);
    }
  });
});
