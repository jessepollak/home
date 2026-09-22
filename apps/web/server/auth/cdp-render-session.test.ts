import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { type VerifiedAccountSession } from "@/shared/account/session-types";
import { HOME_SESSION_COOKIE } from "@/server/auth/native-base-session";
import { readRenderSession } from "@/server/auth/render-session";
import { signedValue } from "@/server/auth/signed-cookie";
import {
  HOME_CDP_LIVE_COOKIE,
  HOME_CDP_SESSION_COOKIE,
  issueCdpRenderHint,
  readCdpRenderSession,
  type RenderCookieStore,
} from "./cdp-render-session";

const KEY = "render-session-test-key-at-least-32-bytes";
const NOW = new Date("2026-09-13T12:00:00.000Z");
const REQUEST = new Request("https://home.example/api/session");
const SESSION: VerifiedAccountSession = {
  user: { subject: "cdp-user-123" },
  smartAccount: {
    address: "0xabcdef0123456789abcdef0123456789abcdef01",
    chainId: 8453,
  },
  accountProvider: "cdp-embedded",
};

describe("CDP render session", () => {
  test("issues and validates only a complete, well-formed cookie pair", () => {
    const issued = issueCdpRenderHint(KEY, SESSION, REQUEST, NOW);
    expect(issued).toHaveLength(2);
    expect(issued[0]).toContain(`${HOME_CDP_SESSION_COOKIE}=`); // oxlint-disable-line home/no-self-referential-expectation -- the issued hint must use the canonical session-cookie name
    expect(issued[0]).toContain("HttpOnly");
    expect(issued[1]).toContain(`${HOME_CDP_LIVE_COOKIE}=`); // oxlint-disable-line home/no-self-referential-expectation -- the issued hint must use the canonical liveness-cookie name
    expect(issued[1]).not.toContain("HttpOnly");
    expect(issued.every((value) =>
      value.includes("Path=/") &&
      value.includes("SameSite=Lax") &&
      value.includes("Max-Age=86400") &&
      value.includes("Secure")
    )).toBe(true);

    const validEntries = issued.map(parseSetCookie);
    const valid = cookieStore(validEntries);
    const live = validEntries.find(([name]) => name === HOME_CDP_LIVE_COOKIE)![1];
    const signed = validEntries.find(([name]) => name === HOME_CDP_SESSION_COOKIE)![1];
    const native = nativeSession();
    const cases: Array<{ name: string; read: () => unknown; expected: unknown }> = [
      {
        name: "valid pair",
        read: () => readCdpRenderSession(valid, KEY, NOW),
        expected: SESSION,
      },
      {
        name: "missing live cookie",
        read: () => readCdpRenderSession(
          cookieStore([[HOME_CDP_SESSION_COOKIE, signed]]),
          KEY,
          NOW,
        ),
        expected: null,
      },
      {
        name: "nonce mismatch",
        read: () => readCdpRenderSession(cookieStore([
          [HOME_CDP_SESSION_COOKIE, signed],
          [HOME_CDP_LIVE_COOKIE, "f".repeat(48)],
        ]), KEY, NOW),
        expected: null,
      },
      {
        name: "expired",
        read: () => readCdpRenderSession(
          valid,
          KEY,
          new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1),
        ),
        expected: null,
      },
      {
        name: "malformed expiry",
        read: () => readCdpRenderSession(
          payloadCookies({ expiresAt: "not-a-date" }),
          KEY,
          NOW,
        ),
        expected: null,
      },
      {
        name: "bad HMAC",
        read: () => readCdpRenderSession(cookieStore([
          [HOME_CDP_SESSION_COOKIE, tamper(signed)],
          [HOME_CDP_LIVE_COOKIE, live],
        ]), KEY, NOW),
        expected: null,
      },
      {
        name: "base-account provider",
        read: () => readCdpRenderSession(payloadCookies({
          provider: "base-account",
          session: { ...SESSION, accountProvider: "base-account" },
        }), KEY, NOW),
        expected: null,
      },
      {
        name: "malformed address",
        read: () => readCdpRenderSession(payloadCookies({
          session: {
            ...SESSION,
            smartAccount: { address: "not-an-address", chainId: 8453 },
          },
        }), KEY, NOW),
        expected: null,
      },
      {
        name: "duplicate cookie",
        read: () => readCdpRenderSession(
          cookieStore([...validEntries, [HOME_CDP_SESSION_COOKIE, signed]]),
          KEY,
          NOW,
        ),
        expected: null,
      },
      {
        name: "home session takes precedence over a valid hint",
        read: () => readRenderSession(
          cookieStore([...validEntries, [HOME_SESSION_COOKIE, native.token]]),
          { HOME_SESSION_SECRET: KEY },
          NOW,
        ),
        expected: { session: native.session, source: "home-session" },
      },
      {
        name: "hint is used without a home session",
        read: () => readRenderSession(valid, { HOME_SESSION_SECRET: KEY }, NOW),
        expected: { session: SESSION, source: "cdp-hint" },
      },
      {
        name: "neither render session is present",
        read: () => readRenderSession(
          cookieStore([]),
          { HOME_SESSION_SECRET: KEY },
          NOW,
        ),
        expected: null,
      },
    ];

    for (const entry of cases) {
      expect(entry.read(), entry.name).toEqual(entry.expected);
    }
  });
});

function payloadCookies(overrides: Record<string, unknown>): RenderCookieStore {
  const nonce = "a".repeat(48);
  const payload = {
    version: 1,
    provider: "cdp-embedded",
    session: SESSION,
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
  return cookieStore([
    [HOME_CDP_SESSION_COOKIE, signedValue(Buffer.from(KEY), JSON.stringify(payload))],
    [HOME_CDP_LIVE_COOKIE, nonce],
  ]);
}

function nativeSession(): { token: string; session: VerifiedAccountSession } {
  const address = "0x1111111111111111111111111111111111111111" as const;
  const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
  const session: VerifiedAccountSession = {
    user: { subject },
    smartAccount: { address, chainId: 8453 },
    accountProvider: "base-account",
  };
  return {
    token: signedValue(Buffer.from(KEY), JSON.stringify({
      version: 1,
      session,
      issuedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    })),
    session,
  };
}

function parseSetCookie(value: string): [string, string] {
  const first = value.slice(0, value.indexOf(";"));
  const separator = first.indexOf("=");
  return [first.slice(0, separator), first.slice(separator + 1)];
}

function cookieStore(entries: Array<[string, string]>): RenderCookieStore {
  return {
    getAll(name) {
      return entries
        .filter(([candidate]) => candidate === name)
        .map(([, value]) => ({ value }));
    },
  };
}

function tamper(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith("x") ? "y" : "x"}`;
}
