import { describe, expect, test } from "bun:test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { signedValue } from "@/server/auth/native-base-session";
import { parseOperatorErrorResponse, parseOperatorSessionResponse } from "@/shared/operator/contract";
import { createOperatorApiHandler } from "./api";
import { decideOperatorAccess } from "./authorize";
import { readOperatorConfig } from "./config";
import { decideOperatorPageAccess } from "./page";

const X = "0x1111111111111111111111111111111111111111" as const;
const Y = "0x2222222222222222222222222222222222222222" as const;
const SECRET = "a".repeat(40);
const NOW = new Date("2026-01-01T00:00:00.000Z");
const session = (address: `0x${string}` | null): VerifiedAccountSession => ({
  user: { subject: "base-user" },
  smartAccount: address ? { address, chainId: BASE_CHAIN_ID } : null,
  accountProvider: address ? "base-account" : "cdp-embedded",
});

function cookieStore(values: Record<string, string[]> = {}) {
  return { getAll: (name: string) => (values[name] ?? []).map((value) => ({ value })) };
}

function nativeToken(address: `0x${string}`, at: Date = NOW) {
  const digest = new Bun.CryptoHasher("sha256").update(address).digest("hex").slice(0, 32);
  return signedValue(Buffer.from(SECRET), JSON.stringify({
    version: 1,
    session: { user: { subject: `base-${digest}` }, smartAccount: { address, chainId: BASE_CHAIN_ID }, accountProvider: "base-account" },
    issuedAt: new Date(at.getTime() - 60_000).toISOString(),
    expiresAt: new Date(at.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
  }));
}

describe("operator configuration", () => {
  test.each([
    [undefined, "absent"], ["", "absent"], ["  ", "absent"],
    [X, "configured"], [`  ${X}\t,\n${Y}  `, "configured"],
    [`${X},`, "misconfigured"], [`${X},,${Y}`, "misconfigured"],
    ["0x1234", "misconfigured"], [`0x${"g".repeat(40)}`, "misconfigured"],
    ["1".repeat(40), "misconfigured"], [`${X.slice(0, 20)} ${X.slice(20)}`, "misconfigured"],
    [`0x${"aA".repeat(20)},0x${"Aa".repeat(20)}`, "misconfigured"],
    [`\u00a0${X}`, "misconfigured"],
  ] as Array<[string | undefined, "absent" | "configured" | "misconfigured"]>)("parses %s as %s", (raw, kind) => {
    const config = readOperatorConfig({ HOME_OPERATOR_ADDRESSES: raw });
    expect(config.kind).toBe(kind);
    if (config.kind === "configured") expect([...config.addresses]).toEqual(raw?.includes(",") ? [X, Y] : [X]);
  });
  test("normalizes mixed-case hex", () => {
    const upper = `0x${"Aa".repeat(20)}`;
    const config = readOperatorConfig({ HOME_OPERATOR_ADDRESSES: `\t${upper}\r` });
    expect(config.kind === "configured" ? [...config.addresses] : null).toEqual([`0x${"aa".repeat(20)}`]);
  });
});

test("operator decision fails closed, independently of customer access, and follows rotation", () => {
  const configA = readOperatorConfig({ HOME_OPERATOR_ADDRESSES: X });
  const configB = readOperatorConfig({ HOME_OPERATOR_ADDRESSES: Y });
  expect(decideOperatorAccess(null, configA)).toEqual({ kind: "unauthenticated" });
  expect(decideOperatorAccess(session(null), configA)).toEqual({ kind: "forbidden" });
  expect(decideOperatorAccess(session(Y), configA)).toEqual({ kind: "forbidden" });
  expect(decideOperatorAccess(session(X), configA)).toEqual({ kind: "operator", address: X });
  expect(decideOperatorAccess(session(X), readOperatorConfig({}))).toEqual({ kind: "forbidden" });
  expect(decideOperatorAccess(session(X), readOperatorConfig({ HOME_OPERATOR_ADDRESSES: `${X},` }))).toEqual({ kind: "forbidden" });
  expect(decideOperatorAccess(session(X), configB)).toEqual({ kind: "forbidden" });
  expect(decideOperatorAccess(session(Y), configB)).toEqual({ kind: "operator", address: Y });
});

test("page boundary accepts only one verified native session and treats any unverified Home cookie as signed in", () => {
  const env = { HOME_SESSION_SECRET: SECRET, HOME_OPERATOR_ADDRESSES: X };
  expect(decideOperatorPageAccess(cookieStore(), env, NOW)).toEqual({ kind: "unauthenticated" });
  expect(decideOperatorPageAccess(cookieStore({ "home-cdp-session": ["hint"], "home-cdp-live": ["live"] }), env, NOW)).toEqual({ kind: "forbidden" });
  expect(decideOperatorPageAccess(cookieStore({ "home-session": ["invalid"] }), env, NOW)).toEqual({ kind: "forbidden" });
  expect(decideOperatorPageAccess(cookieStore({ "home-session": [nativeToken(X), nativeToken(X)] }), env, NOW)).toEqual({ kind: "forbidden" });
  expect(decideOperatorPageAccess(cookieStore({ "home-session": [nativeToken(X)] }), env, NOW)).toEqual({ kind: "operator", address: X });
  expect(decideOperatorPageAccess(cookieStore({ "home-session": [nativeToken(Y)] }), env, NOW)).toEqual({ kind: "forbidden" });
});

test("admin API accepts an unambiguous native session cookie without a provider header", async () => {
  const priorSecret = process.env.HOME_SESSION_SECRET;
  const priorAddresses = process.env.HOME_OPERATOR_ADDRESSES;
  try {
    process.env.HOME_SESSION_SECRET = SECRET;
    process.env.HOME_OPERATOR_ADDRESSES = X;
    const response = await createOperatorApiHandler(true)(new Request("https://home.test/api/admin/session", {
      headers: { cookie: `home-session=${nativeToken(X, new Date())}` },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ version: 1, operator: { address: X } });
  } finally {
    if (priorSecret === undefined) delete process.env.HOME_SESSION_SECRET;
    else process.env.HOME_SESSION_SECRET = priorSecret;
    if (priorAddresses === undefined) delete process.env.HOME_OPERATOR_ADDRESSES;
    else process.env.HOME_OPERATOR_ADDRESSES = priorAddresses;
  }
});

test("admin API status, contract and private headers across both endpoints", async () => {
  const request = new Request("https://home.test/api/admin/session");
  const unavailable = Response.json({ error: { code: "AUTH_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const cases = [
    { found: true, auth: async () => Response.json({}, { status: 401 }), status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    { found: true, auth: async () => session(null), status: 403, body: { error: { code: "OPERATOR_FORBIDDEN" } } },
    { found: true, auth: async () => session(Y), status: 403, body: { error: { code: "OPERATOR_FORBIDDEN" } } },
    { found: true, auth: async () => session(X), status: 200, body: { version: 1, operator: { address: X } } },
    { found: true, auth: async () => unavailable, status: 503, body: { error: { code: "AUTH_UNAVAILABLE" } } },
    { found: false, auth: async () => Response.json({}, { status: 401 }), status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    { found: false, auth: async () => session(Y), status: 403, body: { error: { code: "OPERATOR_FORBIDDEN" } } },
    { found: false, auth: async () => session(X), status: 404, body: { error: { code: "NOT_FOUND" } } },
  ];
  for (const item of cases) {
    const response = await createOperatorApiHandler(item.found, item.auth, () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: X }))(request);
    expect(response.status).toBe(item.status);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual(item.body);
    if (item.status === 200) expect(parseOperatorSessionResponse(body)?.operator.address).toBe(X);
    if (item.status === 401 || item.status === 403 || item.status === 404) {
      expect(item.body.error?.code).toBe(parseOperatorErrorResponse(body)?.error.code);
    }
  }
});
