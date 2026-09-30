import { createHash } from "node:crypto";
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { NextRequest } from "next/server";
import { INVITE_CODE_ALPHABET, invitePath, isInviteCode, parseInviteLinkResponse } from "@/shared/invites/contract";
import { issueCdpRenderHint } from "@/server/auth/cdp-render-session";
import { readRenderSession } from "@/server/auth/render-session";
import { signedValue } from "@/server/auth/signed-cookie";
import { HOME_INVITE_COOKIE, issueInviteCookie, readInviteCookie } from "./cookie";
import { createInviteLandingHandler } from "./landing";
import { recordVerifiedCustomer } from "./consumption";
import { createInviteLinkHandler } from "./api";
import { generateInviteCode } from "./store";

const secret = "a".repeat(32);
const code = "abcdefghjk";
const other = "mnpqrstuvw";
const address = `0x${"1".repeat(40)}` as const;
const session = { accountProvider: "cdp-embedded" as const, user: { subject: "test" }, smartAccount: { chainId: 8453 as const, address } };
const now = new Date("2026-01-01T00:00:00Z");
afterEach(() => setSystemTime());
const request = (cookies = "", method = "GET") => new Request(`https://home.test/invite/${code}`, { method, headers: { cookie: cookies } });
const makeCookie = (value: string) => `${HOME_INVITE_COOKIE}=${value.split(";")[0].split("=").slice(1).join("=")}`;

describe("invitation code and cookie", () => {
  test("uses only the uniform rejection range and parses public responses", () => {
    const alphabetLength = INVITE_CODE_ALPHABET.length;
    let first = true;
    const generated = generateInviteCode((size) => Uint8Array.from({ length: size }, (_, index) => first && index === 0 ? (first = false, 255) : 0));
    expect(generated).toBe("a".repeat(10));
    expect(alphabetLength).toBe(31);
    expect(isInviteCode(generated)).toBe(true);
    expect(invitePath(generated)).toBe(`/invite/${generated}`);
    expect(parseInviteLinkResponse({ version: 1, code: generated })).toEqual({ version: 1, code: generated });
    expect(parseInviteLinkResponse({ version: 2, code: generated })).toBeNull();
    expect(isInviteCode("iiiiiiiiii")).toBe(false);
  });

  test("signs and domain separates a 30-day HttpOnly invite token", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = issueInviteCookie(request(), code, now, secret)!;
    expect(issued).toContain("Max-Age=2592000");
    expect(issued).toContain("HttpOnly");
    expect(issued).toContain("Secure");
    const stored = makeCookie(issued);
    expect(readInviteCookie(request(stored), new Date(now.getTime() + 2_592_000_000), secret)).toBe(code);
    expect(readInviteCookie(request(stored), new Date(now.getTime() + 2_592_001_000), secret)).toBeNull();
    expect(readInviteCookie(request(stored), new Date(now.getTime() - 1000), secret)).toBeNull();
    expect(readInviteCookie(request(stored.replace(/.$/, "x")), now, secret)).toBeNull();
    expect(readInviteCookie(request(stored), now, "x".repeat(32))).toBeNull();
    expect(issueInviteCookie(request(), code, now, undefined)).toBeNull();
  });
});

const landing = createInviteLandingHandler({
  available: () => true,
  findInviter: async (value) => value === code ? { customerId: "inviter", status: "active" } : null,
  readInvite: (req) => readInviteCookie(req, new Date("2026-01-01T00:00:00Z"), secret),
  issueInvite: (req, value) => issueInviteCookie(req, value, now, secret),
  readSession: (cookies) => readRenderSession(cookies, { HOME_SESSION_SECRET: secret }, now),
});
const land = (req: Request, value = code) => landing(req, { params: Promise.resolve({ code: value }) });

function nativeCookie(expiresAt: Date): string {
  const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
  const token = signedValue(Buffer.from(secret), JSON.stringify({
    version: 1,
    session: { accountProvider: "base-account", user: { subject }, smartAccount: { chainId: 8453, address } },
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }));
  return `home-session=${token}`;
}

describe("invite landing", () => {
  test("sets a first touch for GET and HEAD, redirects without caching", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await land(request("", method));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toContain(HOME_INVITE_COOKIE);
    }
  });
  test("signed-in visits and existing valid first touch do not replace it", async () => {
    const prior = makeCookie(issueInviteCookie(request(), other, now, secret)!);
    expect((await land(request(prior))).headers.get("set-cookie")).toBeNull();
    const native = nativeCookie(new Date(now.getTime() + 60_000));
    const cdp = issueCdpRenderHint(secret, session, request(), now).map((value) => value.split(";")[0]);
    for (const cookies of [native, cdp.join("; ")]) {
      const response = await land(request(cookies));
      expect(response.headers.get("location")).toBe("/home");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
  test("invalid and partial session cookies still attribute a signed-out visitor", async () => {
    const native = nativeCookie(new Date(now.getTime() + 60_000));
    const expiredNative = nativeCookie(new Date(now.getTime() - 1));
    const cdp = issueCdpRenderHint(secret, session, request(), now).map((value) => value.split(";")[0]);
    const expiredCdp = issueCdpRenderHint(secret, session, request(), new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000))
      .map((value) => value.split(";")[0]);
    const tamper = (value: string) => `${value.slice(0, -1)}${value.endsWith("x") ? "y" : "x"}`;
    for (const cookies of [
      expiredNative,
      tamper(native),
      `${native}; ${native}`,
      expiredCdp.join("; "),
      [tamper(cdp[0]), cdp[1]].join("; "),
      [...cdp, cdp[0]].join("; "),
      cdp[0],
      cdp[1],
    ]) {
      const response = await land(request(cookies));
      expect(response.headers.get("location"), cookies).toBe("/");
      expect(response.headers.get("set-cookie"), cookies).toContain(`${HOME_INVITE_COOKIE}=`);
    }
  });
  test("malformed, unknown, inactive, unavailable and lookup failures redirect home without cookies", async () => {
    const cases = [land(request(), "invalid"), land(request(), other),
      createInviteLandingHandler({ available: () => true, findInviter: async () => ({ customerId: "x", status: "closed" }), readInvite: () => null, issueInvite: () => "bad", readSession: () => null })(request(), { params: Promise.resolve({ code }) }),
      createInviteLandingHandler({ available: () => false, findInviter: async () => { throw Error(); }, readInvite: () => null, issueInvite: () => "bad", readSession: () => null })(request(), { params: Promise.resolve({ code }) }),
      createInviteLandingHandler({ available: () => true, findInviter: async () => { throw Error(); }, readInvite: () => null, issueInvite: () => "bad", readSession: () => null })(request(), { params: Promise.resolve({ code }) })];
    for (const response of await Promise.all(cases)) {
      expect(response.headers.get("location")).toBe("/");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("verified invitation consumption", () => {
  test("waits for a valid invite write and defers absent or invalid invite writes", async () => {
    const issuedAt = new Date("2026-09-28T12:00:00.000Z");
    setSystemTime(issuedAt);
    const previousSecret = process.env.HOME_SESSION_SECRET;
    process.env.HOME_SESSION_SECRET = secret;
    try {
      const written: Array<string | null> = [];
      let synchronous = 0;
      let deferred = 0;
      const write = async (inviteCode: string | null) => { written.push(inviteCode); };
      const now = async (operation: () => Promise<unknown>) => { synchronous += 1; await operation(); };
      const later = async (operation: () => Promise<unknown>) => { deferred += 1; await operation(); };
      const valid = makeCookie(issueInviteCookie(request(), code, issuedAt, secret)!);
      await recordVerifiedCustomer(request(valid), write, now, later);
      expect(synchronous).toBe(1);
      expect(deferred).toBe(0);
      expect(written).toEqual([code]);

      expect(recordVerifiedCustomer(request(), write, now, later)).toBeUndefined();
      expect(recordVerifiedCustomer(request(`${HOME_INVITE_COOKIE}=invalid`), write, now, later)).toBeUndefined();
      expect(synchronous).toBe(1);
      expect(deferred).toBe(2);
      expect(written).toEqual([code, null, null]);
    } finally {
      if (previousSecret === undefined) delete process.env.HOME_SESSION_SECRET;
      else process.env.HOME_SESSION_SECRET = previousSecret;
    }
  });
});

describe("invite link API", () => {
  const handle = (status: string, available = true) => createInviteLinkHandler({
    authorize: async () => session,
    available: () => available,
    resolve: async () => ({ id: "customer", status, created: false, credentialId: "credential", walletId: null }),
    code: async () => code,
  });
  test("authorizes a Next route request with the same method, URL and provider headers", async () => {
    const original = new NextRequest("https://home.test/api/invites/link?source=account", {
      headers: { cookie: "home-session=invalid", authorization: "Bearer token" },
    });
    const handler = createInviteLinkHandler({
      authorize: async (input) => {
        expect(input.url).toBe(original.url);
        expect(input.method).toBe("GET");
        expect(input.headers.get("cookie")).toBe("home-session=invalid");
        expect(input.headers.get("authorization")).toBe("Bearer token");
        expect(input.headers.get("x-home-account-provider")).toBe("base-account");
        return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
      },
      available: () => true, resolve: async () => null, code: async () => code,
    });
    expect((await handler(original)).status).toBe(401);
  });

  test("returns 401, 503, 403 or private versioned link", async () => {
    const unauthorized = createInviteLinkHandler({ authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }), available: () => true, resolve: async () => null, code: async () => code });
    expect((await unauthorized(request())).status).toBe(401);
    expect(await (await handle("active", false)(request())).json()).toEqual({ error: { code: "INVITES_UNAVAILABLE" } });
    expect((await handle("active", false)(request())).status).toBe(503);
    expect((await handle("closed")(request())).status).toBe(403);
    const response = await handle("active")(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ version: 1, code });
  });
});
