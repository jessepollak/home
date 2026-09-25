import { describe, expect, test } from "bun:test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseAllSettingsResponse, parseAuditListResponse, parseOperatorSettingsErrorResponse, parsePutSettingsRequest, parseSettingsResponse, parseSupportSettings } from "@/shared/operator-settings/contract";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "./handlers";
import { AdminAuditLog } from "./audit";
import { OperatorSettingsConflictError, OperatorSettingsStore, OperatorSettingsValidationError } from "./store";

const X = "0x1111111111111111111111111111111111111111" as const;
const Y = "0x2222222222222222222222222222222222222222" as const;
const context = { params: Promise.resolve({ domain: "support" }) };
const entry = { domain: "support", settings: { value: { email: null, url: null }, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null } };
const config = () => ({ kind: "configured" as const, addresses: new Set([X]) });
const session = (address: `0x${string}` | null): VerifiedAccountSession => ({
  user: { subject: "operator" }, smartAccount: address ? { address, chainId: BASE_CHAIN_ID } : null,
  accountProvider: "base-account",
});
const response = async (result: Response, status: number) => {
  expect(result.status).toBe(status);
  expect(result.headers.get("cache-control")).toContain("private");
  expect(result.headers.get("cache-control")).toContain("no-store");
  return result.json();
};
const request = (method = "GET", path = "settings/support", init: RequestInit = {}) => new Request(`https://home.test/api/admin/${path}`, { ...init, method });
const put = (body: unknown, headers: Record<string, string> = {}) => request("PUT", "settings/support", { headers: { origin: "https://home.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const value = { email: "support@example.com", url: "https://example.com/support" };

const fakeStore = {
  hasDomain: (domain: string) => domain === "support",
  read: async () => entry,
  readAll: async () => [entry],
  write: async () => entry,
} as unknown as OperatorSettingsStore;
const fakeAudit = { list: async () => ({ entries: [], nextCursor: null }) } as unknown as AdminAuditLog;
const deps = (authorize: () => Promise<VerifiedAccountSession | Response> = async () => session(X)) => ({ authorize, config, store: () => fakeStore, audit: () => fakeAudit });

describe("support contract", () => {
  test.each([
    [{ email: null, url: null }, true], [value, true], [{ email: "support@home.test ", url: null }, false],
    [{ email: "invalid", url: null }, false], [{ email: `${"x".repeat(250)}@a.co`, url: null }, false],
    [{ email: null, url: "http://example.com" }, false], [{ email: null, url: "https://user:pass@example.com" }, false],
    [{ email: null, url: `https://example.com/${"x".repeat(2050)}` }, false],
    [{ email: null }, false], [{ email: null, url: null, extra: true }, false],
  ])("checks exact schema and support value %#", (input, valid) => {
    expect(parseSupportSettings(input) !== null).toBe(valid);
  });
  test("PUT contract rejects unknown keys, invalid versions, and negative revisions", () => {
    expect(parsePutSettingsRequest({ version: 1, expectedRevision: 0, value })).toEqual({ version: 1, expectedRevision: 0, value });
    for (const input of [{ version: 1, expectedRevision: -1, value }, { version: 1, expectedRevision: 0, value, extra: 1 }, { version: 2, expectedRevision: 0, value }, { version: 1, expectedRevision: 0 }]) expect(parsePutSettingsRequest(input)).toBeNull();
  });
  test("future-client response parsers accept typed responses", () => {
    expect(parseSettingsResponse({ version: 1, ...entry })).not.toBeNull();
    expect(parseAllSettingsResponse({ version: 1, domains: [entry] })).not.toBeNull();
    expect(parseAuditListResponse({ version: 1, entries: [], nextCursor: null })).not.toBeNull();
    expect(parseOperatorSettingsErrorResponse({ error: { code: "NOT_FOUND" } })).not.toBeNull();
  });
});

test("each endpoint authorizes before accessing stores", async () => {
  const variants = [
    { authorize: async () => Response.json({}, { status: 401 }), config, status: 401, code: "UNAUTHENTICATED" },
    { authorize: async () => session(Y), config, status: 403, code: "OPERATOR_FORBIDDEN" },
    { authorize: async () => session(null), config, status: 403, code: "OPERATOR_FORBIDDEN" },
    { authorize: async () => session(X), config: () => ({ kind: "misconfigured" as const }), status: 403, code: "OPERATOR_FORBIDDEN" },
    { authorize: async () => session(X), config, status: 200, code: null },
  ];
  for (const variant of variants) {
    const dependencies = { ...deps(variant.authorize), config: variant.config };
    const endpoints = [
      createSettingsListHandler(dependencies)(request("GET", "settings")),
      createSettingsDomainHandlers(dependencies).GET(request(), context),
      createSettingsDomainHandlers(dependencies).PUT(put({ version: 1, expectedRevision: 0, value }), context),
      createAuditListHandler(dependencies)(request("GET", "audit")),
    ];
    for (const endpoint of endpoints) {
      const body = await response(await endpoint, variant.status);
      if (variant.code) expect(body.error.code).toBe(variant.code);
    }
  }
});

test("domain auth precedes 404, and unknown domains return 404", async () => {
  const unknown = { params: Promise.resolve({ domain: "other" }) };
  expect((await response(await createSettingsDomainHandlers(deps()).GET(request(), unknown), 404)).error.code).toBe("NOT_FOUND");
  expect((await response(await createSettingsDomainHandlers(deps()).PUT(put({ version: 1, expectedRevision: 0, value }), unknown), 404)).error.code).toBe("NOT_FOUND");
});

test("PUT rejects cross-origin and malformed bodies before writing", async () => {
  let writes = 0;
  const store = { ...fakeStore, write: async (input: { value: unknown }) => { if (!parseSupportSettings(input.value)) throw new OperatorSettingsValidationError(); writes++; return entry; } } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(), store: () => store }).PUT;
  for (const req of [
    put({ version: 1, expectedRevision: 0, value }, { origin: "https://other.test" }),
    put({ version: 1, expectedRevision: 0, value }, { "sec-fetch-site": "cross-site" }),
    request("PUT", "settings/support", { headers: { "content-type": "application/json" }, body: "{}" }),
  ]) expect((await response(await handler(req, context), 403)).error.code).toBe("CROSS_ORIGIN");
  for (const req of [
    put({ version: 1, expectedRevision: 0, value }, { "content-type": "text/plain" }),
    request("PUT", "settings/support", { headers: { origin: "https://home.test", "content-type": "application/json" }, body: "{" }),
    put({ version: 1, expectedRevision: 0, value, extra: 1 }),
    put({ version: 1, expectedRevision: 0, value: { email: "bad", url: null } }),
    put({ version: 1, expectedRevision: 0, value }, { "content-length": "16385" }),
    put({ version: 1, expectedRevision: 0, value: { email: null, url: `https://example.com/${"x".repeat(16400)}` } }),
  ]) expect((await response(await handler(req, context), 400)).error.code).toBe("INVALID_REQUEST");
  expect(writes).toBe(0);
});

test("conflicts include current revision; unavailable DB and corrupt values fail closed", async () => {
  const conflict = { ...fakeStore, write: async () => { throw new OperatorSettingsConflictError(); } } as unknown as OperatorSettingsStore;
  const unavailable = { ...fakeStore, readAll: async () => { throw new Error("database unavailable"); } } as unknown as OperatorSettingsStore;
  const invalid = { ...fakeStore, write: async () => { throw new OperatorSettingsValidationError(); } } as unknown as OperatorSettingsStore;
  const body = await response(await createSettingsDomainHandlers({ ...deps(), store: () => conflict }).PUT(put({ version: 1, expectedRevision: 0, value }), context), 409);
  expect(body.current.settings.revision).toBe(0);
  expect(body.error.code).toBe("SETTINGS_CONFLICT");
  expect((await response(await createSettingsListHandler({ ...deps(), store: () => unavailable })(request()), 503)).error.code).toBe("SETTINGS_UNAVAILABLE");
  expect((await response(await createSettingsDomainHandlers({ ...deps(), store: () => invalid }).PUT(put({ version: 1, expectedRevision: 0, value }), context), 400)).error.code).toBe("INVALID_REQUEST");
  expect((await response(await createAuditListHandler(deps())(request("GET", "audit?limit=0")), 400)).error.code).toBe("INVALID_REQUEST");
});
