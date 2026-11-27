import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { BASE_CHAIN_ID } from "@/shared/account/session-types";
import { parseOperatorErrorResponse } from "@/shared/operator/contract";
import { parseOperatorSettingsErrorResponse } from "@/shared/operator-settings/contract";
import { issueCdpRenderHint } from "@/server/auth/cdp-render-session";
import { AccountDeletedError, AccountDeletionAuthUnavailable } from "@/server/account-deletion/errors";
import { authorizeSession } from "@/server/auth/authorize";
import { readNativeBaseSessionToken } from "@/server/auth/native-base-session";
import { readSignedValue, signedValue } from "@/server/auth/signed-cookie";
import { createRewardDecisionHandler } from "@/server/growth/admin-handlers";
import { readOperatorGrant } from "@/server/operator/email-grant";
import { createOperatorApiHandler, createOperatorGrantHandler, operatorGrantReader } from "@/server/operator/api";
import { decideOperatorPageAccess } from "@/server/operator/page";
import { readOperatorConfig } from "@/server/operator/config";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "@/server/operator-settings/handlers";
import { createCustomerDetailHandler, createCustomerSearchHandler } from "@/server/admin-customers/handlers";
import { parseAdminCustomersErrorResponse } from "@/shared/admin-customers/contract";

const operator = "0x1111111111111111111111111111111111111111" as const;
const customer = "0x2222222222222222222222222222222222222222" as const;
const context = { params: Promise.resolve({ domain: "support" }) };
const session = (address: typeof operator | typeof customer): VerifiedAccountSession => ({
  user: { subject: "operator-authorization-test" },
  smartAccount: { address, chainId: BASE_CHAIN_ID },
  accountProvider: "base-account",
});
const request = (path: string, body?: unknown) => new Request(`https://home.test/api/admin/${path}`, body === undefined ? {} : {
  method: "PUT",
  headers: { origin: "https://home.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("operator authorization precedes malformed-body parsing and settings or audit data access", async () => {
  const denyDataAccess = () => { throw new Error("operator data accessed before authorization"); };
  for (const variant of [
    { authorize: async () => Response.json({}, { status: 401 }), status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(customer), status: 403, code: "OPERATOR_FORBIDDEN" },
  ]) {
    const dependencies = {
      authorize: variant.authorize,
      config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator }),
      store: denyDataAccess,
      audit: denyDataAccess,
      sql: denyDataAccess,
    };
    const handlers = createSettingsDomainHandlers(dependencies);
    for (const response of [
      await handlers.GET(request("settings/support"), context),
      await handlers.PUT(request("settings/support", { malformed: true }), context),
      await createSettingsListHandler(dependencies)(request("settings")),
      await createAuditListHandler(dependencies)(request("audit")),
      await createRewardDecisionHandler(dependencies)(request("growth/rewards/not-a-uuid", { malformed: true }), { params: Promise.resolve({ id: "not-a-uuid" }) }),
    ]) {
      expect(response.status).toBe(variant.status);
      expect<unknown>(parseOperatorSettingsErrorResponse(await response.json())).toEqual({ error: { code: variant.code } });
    }
    const fallback = await createOperatorApiHandler(false, variant.authorize, dependencies.config)(request("unknown"));
    expect(fallback.status).toBe(variant.status);
    expect<unknown>(parseOperatorErrorResponse(await fallback.json())).toEqual({ error: { code: variant.code } });
  }
});

const SECRET = "operator-email-grant-test-secret-32-bytes!";
const ORIGIN = "https://home.test";
const now = new Date("2026-03-01T12:00:00.000Z");
const env = { HOME_SESSION_SECRET: SECRET, HOME_OPERATOR_ADDRESSES: operator };
const grantConfig = () => readOperatorConfig(env);
const previousSecret = process.env.HOME_SESSION_SECRET;

beforeEach(() => { process.env.HOME_SESSION_SECRET = SECRET; });
afterEach(() => {
  if (previousSecret === undefined) delete process.env.HOME_SESSION_SECRET;
  else process.env.HOME_SESSION_SECRET = previousSecret;
});

const emailSession = (address: `0x${string}`, subject = "email-operator"): VerifiedAccountSession => ({
  user: { subject },
  smartAccount: { address, chainId: BASE_CHAIN_ID },
  accountProvider: "cdp-embedded",
});

function pairs(setCookies: string[]): string {
  return setCookies.map((value) => value.split(";")[0]).join("; ");
}

function hint(session: VerifiedAccountSession, at = now): string {
  return pairs(issueCdpRenderHint(SECRET, session, new Request(ORIGIN), at));
}

function cookieStore(cookieHeader: string) {
  return {
    getAll(name: string) {
      return cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`))
        .map((part) => ({ value: part.slice(name.length + 1) }));
    },
  };
}

async function mint(cookieHeader: string, verified: VerifiedAccountSession | Response, at = now, headers: Record<string, string> = {}) {
  const handler = createOperatorGrantHandler(async () => verified, grantConfig, () => SECRET, () => at);
  return handler(new Request(`${ORIGIN}/api/admin/session`, {
    method: "POST",
    headers: { cookie: cookieHeader, authorization: "Bearer a.b.c", ...headers },
  }));
}

async function grantCookie(cookieHeader: string, session = emailSession(operator), at = now): Promise<string> {
  const response = await mint(cookieHeader, session, at);
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("grant was not issued");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Max-Age=900");
  return setCookie.split(";")[0];
}

const rejectBearer = async () => { throw new Error("cookie-only request reached the bearer authorizer"); };

test("a bearer-verified allowlisted email session opens Admin pages and APIs only with its render hint", async () => {
  const hinted = hint(emailSession(operator));
  expect(decideOperatorPageAccess(cookieStore(hinted), env, now)).toEqual({ kind: "verify-email" });

  const granted = `${hinted}; ${await grantCookie(hinted)}`;
  expect(decideOperatorPageAccess(cookieStore(granted), env, now)).toEqual({ kind: "operator", address: operator, provider: "cdp-embedded" });
  const api = await createOperatorApiHandler(true, rejectBearer, grantConfig, operatorGrantReader(() => now))(new Request(`${ORIGIN}/api/admin/session`, { headers: { cookie: granted } }));
  expect(api.status).toBe(200);
  expect(await api.json()).toEqual({ version: 1, operator: { address: operator } });

  const grantOnly = granted.split("; ").filter((part) => part.startsWith("home-operator-grant=")).join("; ");
  expect(decideOperatorPageAccess(cookieStore(grantOnly), env, now)).toEqual({ kind: "unauthenticated" });
  const withoutLive = granted.split("; ").filter((part) => !part.startsWith("home-cdp-live=")).join("; ");
  expect(decideOperatorPageAccess(cookieStore(withoutLive), env, now)).toEqual({ kind: "forbidden" });
  const otherUser = `${hint(emailSession(operator, "other-email-user"))}; ${grantOnly}`;
  expect(decideOperatorPageAccess(cookieStore(otherUser), env, now)).toEqual({ kind: "verify-email" });
  expect(decideOperatorPageAccess(cookieStore(granted), { ...env, HOME_OPERATOR_ADDRESSES: customer }, now)).toEqual({ kind: "forbidden" });
  expect(decideOperatorPageAccess(cookieStore(granted), env, new Date(now.getTime() + 15 * 60_000))).toEqual({ kind: "verify-email" });
  const tampered = granted.replace(/(home-operator-grant=v1\.)([A-Za-z0-9_-])/, (_, prefix: string, first: string) => `${prefix}${first === "A" ? "B" : "A"}`);
  expect(decideOperatorPageAccess(cookieStore(tampered), env, now)).toEqual({ kind: "verify-email" });
});

test("operator grants accept only their purpose-derived signing key", async () => {
  const verified = emailSession(operator);
  const hinted = hint(verified);
  const payload = JSON.stringify({ version: 1, subject: verified.user.subject, address: operator,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  });
  const key = createHmac("sha256", SECRET).update("home-operator-grant").digest();
  const derived = signedValue(key, payload);
  const raw = signedValue(Buffer.from(SECRET), payload);
  expect(readOperatorGrant(cookieStore(`${hinted}; home-operator-grant=${derived}`), SECRET, now)).toEqual(verified);
  expect(readOperatorGrant(cookieStore(`${hinted}; home-operator-grant=${raw}`), SECRET, now)).toBeNull();
  const issued = (await grantCookie(hinted)).slice("home-operator-grant=".length);
  expect(readSignedValue(key, issued)).toBe(payload);
});

test("a native home-session token cannot act as an operator grant", () => {
  const native = { ...session(operator), user: { subject: `base-${createHash("sha256").update(operator).digest("hex").slice(0, 32)}` } };
  const token = signedValue(Buffer.from(SECRET), JSON.stringify({ version: 1, session: native,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  }));
  expect(readNativeBaseSessionToken(token, SECRET, now).kind).toBe("valid");
  const hinted = hint(emailSession(operator, native.user.subject));
  expect(readOperatorGrant(cookieStore(`${hinted}; home-operator-grant=${token}`), SECRET, now)).toBeNull();
});

test("grant tombstones and lookup failures match bearer authorization responses", async () => {
  const hinted = hint(emailSession(operator));
  const granted = `${hinted}; ${await grantCookie(hinted)}`;
  const cookieRequest = new Request(`${ORIGIN}/api/admin/session`, { headers: { cookie: granted } });
  const bearerRequest = new Request(`${ORIGIN}/api/admin/session`, { headers: { Authorization: "Bearer test" } });
  for (const { error, status, body } of [
    { error: new AccountDeletedError(), status: 401, body: { error: { code: "UNAUTHENTICATED" } } },
    { error: new AccountDeletionAuthUnavailable(), status: 503, body: { error: { code: "AUTH_UNAVAILABLE", message: "Authentication is temporarily unavailable." } } },
    { error: new Error("tombstone lookup failed"), status: 503, body: { error: { code: "AUTH_UNAVAILABLE", message: "Authentication is temporarily unavailable." } } },
  ]) {
    const live = async () => { throw error; };
    const grantResult = await operatorGrantReader(() => now, live)(cookieRequest);
    if (!(grantResult instanceof Response)) throw new Error("grant liveness failure did not return a response");
    const response = await createOperatorApiHandler(true, rejectBearer, grantConfig, async () => grantResult)(cookieRequest);
    const bearerResponse = await createOperatorApiHandler(true,
      (request) => authorizeSession(request, async () => emailSession(operator), live), grantConfig)(bearerRequest);
    expect(response.status).toBe(status);
    expect(bearerResponse.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(await bearerResponse.json()).toEqual(body);
    if (status === 503) expect(response).toBe(grantResult);
  }
});

test("hint-only email pages verify only allowlisted accounts", () => {
  const hinted = cookieStore(hint(emailSession(operator)));
  expect(decideOperatorPageAccess(hinted, env, now)).toEqual({ kind: "verify-email" });
  for (const allowlist of [undefined, "not-an-address", customer]) {
    expect(decideOperatorPageAccess(hinted, { ...env, HOME_OPERATOR_ADDRESSES: allowlist }, now)).toEqual({ kind: "forbidden" });
  }
  expect(decideOperatorPageAccess(cookieStore(hint(emailSession(customer))), env, now)).toEqual({ kind: "forbidden" });
});

test("a render hint alone never authorizes the admin API", async () => {
  const response = await createOperatorApiHandler(true, async () => Response.json({}, { status: 401 }), grantConfig)(
    new Request(`${ORIGIN}/api/admin/session`, { headers: { cookie: hint(emailSession(operator)) } }),
  );
  expect(response.status).toBe(401);
});

test("the grant is issued only to an allowlisted email session with a matching render hint", async () => {
  const hinted = hint(emailSession(operator));
  const denied = [
    [await mint(hint(emailSession(customer)), emailSession(customer)), 403],
    [await mint("", emailSession(operator)), 401],
    [await mint(hint(emailSession(operator, "other-email-user")), emailSession(operator)), 401],
    [await mint(hinted, { ...emailSession(operator), accountProvider: "base-account" }), 401],
    [await mint(hinted, Response.json({}, { status: 401 })), 401],
    [await mint(hinted, Response.json({}, { status: 503 })), 503],
    [await mint(`${hinted}; home-session=v1.x.y`, emailSession(operator)), 401],
  ] as const;
  const withoutBearer = await createOperatorGrantHandler(async () => emailSession(operator), grantConfig, () => SECRET, () => now)(
    new Request(`${ORIGIN}/api/admin/session`, { method: "POST", headers: { cookie: hinted } }),
  );
  for (const [response, status] of [...denied, [withoutBearer, 401] as const]) {
    expect(response.status).toBe(status);
    expect(response.headers.get("set-cookie")).toBeNull();
  }
});

test("customer search and detail authorize before parsing, store, audit or balance access", async () => {
  const denyDataAccess = () => { throw new Error("customer data accessed before authorization"); };
  const id = "11111111-1111-4111-8111-111111111111";
  for (const variant of [
    { authorize: async () => Response.json({}, { status: 401 }), status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(customer), status: 403, code: "OPERATOR_FORBIDDEN" },
  ] as const) {
    const dependencies = { authorize: variant.authorize, config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: operator }), store: denyDataAccess, audit: denyDataAccess, balances: denyDataAccess };
    for (const response of [
      await createCustomerSearchHandler(dependencies)(request("customers", { version: 1, q: ["not", "a", "string"], unknown: true })),
      await createCustomerDetailHandler(dependencies)(request(`customers/${id}`), { params: Promise.resolve({ id }) }),
      await createCustomerDetailHandler(dependencies)(request("customers/not-an-id"), { params: Promise.resolve({ id: "not-an-id" }) }),
    ]) {
      expect(response.status).toBe(variant.status);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect<unknown>(parseAdminCustomersErrorResponse(await response.json())).toEqual({ error: { code: variant.code } });
    }
  }
});
