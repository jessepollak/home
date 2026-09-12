import { describe, expect, test } from "bun:test";
import {
  HOME_CHALLENGE_COOKIE,
  HOME_SESSION_COOKIE,
  NATIVE_BASE_NONCE_TTL_MS,
  createNativeBaseLogoutHandler,
  createNativeBaseNonceHandler,
  createNativeBaseVerifyHandler,
  readNativeBaseSession,
} from "./native-base-session";

const SECRET = "test-secret-that-is-at-least-thirty-two-bytes";
const ADDRESS = "0x1111111111111111111111111111111111111111" as const;
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

async function challenge(
  nonce: ReturnType<typeof createNativeBaseNonceHandler>,
): Promise<{ message: string; cookie: string }> {
  const response = await nonce(post("/api/auth/base/nonce", { address: ADDRESS }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { message: string };
  return {
    message: payload.message,
    cookie: cookieValue(response, HOME_CHALLENGE_COOKIE),
  };
}

describe("native Base authentication handlers", () => {
  test("requires HOME_SESSION_SECRET before issuing a stateless challenge", async () => {
    const nonce = createNativeBaseNonceHandler({
      sessionSecret: "",
      now: () => START,
      randomId: () => NONCE,
    });
    expect((await nonce(post("/api/auth/base/nonce", { address: ADDRESS }))).status).toBe(503);
  });

  test("issues a Base-bound challenge and establishes a signed HttpOnly session", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    expect(issued.message).toContain("Chain ID: 8453");
    expect(issued.message).toContain(`URI: ${ORIGIN}`);

    const verified = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
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

  test("rejects replay after the successful verification clears the challenge cookie", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    expect((await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ))).status).toBe(200);

    const replay = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
    ));
    expect(replay.status).toBe(401);
  });

  test("rejects expired, tampered, and message-mismatched challenges", async () => {
    let current = START;
    const expiring = handlers(() => current);
    const expired = await challenge(expiring.nonce);
    current = new Date(START.getTime() + NATIVE_BASE_NONCE_TTL_MS + 1);
    expect((await expiring.verify(post(
      "/api/auth/base/verify",
      { message: expired.message, signature: "0x1234" },
      expired.cookie,
    ))).status).toBe(401);

    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const tamperedCookie = `${issued.cookie.slice(0, -1)}x`;
    expect((await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      tamperedCookie,
    ))).status).toBe(401);
    expect((await verify(post(
      "/api/auth/base/verify",
      { message: issued.message.replace("Chain ID: 8453", "Chain ID: 1"), signature: "0x1234" },
      issued.cookie,
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
        { message: issued.message, signature: "0x1234" },
        issued.cookie,
      ));
      expect(response.status).toBe(entry.status);
    }
  });

  test("logout requires same-origin POST and clears both authentication cookies", async () => {
    const logout = createNativeBaseLogoutHandler();
    expect((await logout(logoutRequest())).status).toBe(403);
    expect((await logout(logoutRequest({ Origin: "https://evil.example" }))).status).toBe(403);

    const response = await logout(logoutRequest({
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
    }));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });

  test("reads only valid signed Base sessions and rejects cookie tampering", async () => {
    const { nonce, verify } = handlers();
    const issued = await challenge(nonce);
    const response = await verify(post(
      "/api/auth/base/verify",
      { message: issued.message, signature: "0x1234" },
      issued.cookie,
    ));
    const sessionCookie = cookieValue(response, HOME_SESSION_COOKIE);
    expect(readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
      headers: { Cookie: sessionCookie },
    }), SECRET, START).kind).toBe("valid");

    const tampered = `${sessionCookie.slice(0, -1)}x`;
    expect(readNativeBaseSession(new Request(`${ORIGIN}/api/session`, {
      headers: { Cookie: tampered },
    }), SECRET, START)).toEqual({ kind: "invalid" });
  });
});
