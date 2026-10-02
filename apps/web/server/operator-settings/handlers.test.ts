import { readJson } from "@/tests/helpers/read-json";
import { describe, expect, test } from "bun:test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { parseOperatorFeeSettings } from "@/shared/fees/contract";
import { parseAllSettingsResponse, parseAuditListResponse, parseOperatorSettingsErrorResponse, parsePutSettingsRequest, parseSettingsResponse, parseSupportSettings, parseFundingSettings, OPERATOR_SETTINGS_DOMAINS } from "@/shared/operator-settings/contract";
import { createAuditListHandler, createSettingsDomainHandlers, createSettingsListHandler } from "./handlers";
import { AdminAuditLog } from "./audit";
import { OperatorSettingsConflictError, OperatorSettingsStore, OperatorSettingsValidationError } from "./store";
import { deploymentProductSettings } from "@/shared/operator-settings/products";
import { invalidateProductOffering, readProductOffering } from "./offering";
import type { SqlExecutor } from "@/server/db/sql";

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
  return readJson(result);
};
const request = (method = "GET", path = "settings/support", init: RequestInit = {}) => new Request(`https://home.test/api/admin/${path}`, { ...init, method });
const put = (body: unknown, headers: Record<string, string> = {}) => request("PUT", "settings/support", { headers: { origin: "https://home.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const value = { email: "support@example.com", url: "https://example.com/support" };
const feesContext = { params: Promise.resolve({ domain: "fees" }) };
const feeValue = { trade: { bps: 100, recipient: "0x3000000000000000000000000000000000000003" as const } };
const feeEntry = { domain: "fees", settings: { value: feeValue, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null } };
const putDomain = (domain: string, body: unknown) => request("PUT", `settings/${domain}`, { headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify(body) });

const fakeStore = {
  registry: OPERATOR_SETTINGS_DOMAINS,
  hasDomain: (domain: string) => domain === "support" || domain === "funding",
  read: async () => entry,
  readAll: async () => [entry],
  write: async () => entry,
} as unknown as OperatorSettingsStore;
const fakeAudit = { list: async () => ({ entries: [], nextCursor: null }) } as unknown as AdminAuditLog;
const deps = (authorize: () => Promise<VerifiedAccountSession | Response> = async () => session(X)) => ({ authorize, config, store: () => fakeStore, audit: () => fakeAudit });

describe("funding settings contract", () => {
  const corridor = { providerId: "peer", region: "US", direction: "offramp" as const, offered: true };
  test("accepts an empty catalog selection and rejects unknown keys, invalid ids, duplicates, bounds and non-boolean values", () => {
    expect(parseFundingSettings({ corridors: [] })).toEqual({ corridors: [] });
    expect(parseFundingSettings({ corridors: [corridor] })).toEqual({ corridors: [corridor] });
    for (const input of [
      { corridors: [corridor], extra: true }, { corridors: [{ ...corridor, extra: 1 }] },
      { corridors: [{ ...corridor, providerId: "Bad Provider" }] },
      { corridors: [{ ...corridor, region: "USA" }] },
      { corridors: [{ ...corridor, direction: "both" }] },
      { corridors: [corridor, corridor] },
      { corridors: Array.from({ length: 501 }, (_, index) => ({ ...corridor, providerId: `provider${index}` })) },
      { corridors: [{ ...corridor, offered: "true" }] },
    ]) expect(parseFundingSettings(input)).toBeNull();
  });
});

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
    expect(parsePutSettingsRequest({ version: 1, expectedRevision: 0, value })).toBeNull();
    for (const input of [{ version: 1, expectedRevision: -1, value, operator: X }, { version: 1, expectedRevision: 0, value, operator: X, extra: 1 }, { version: 2, expectedRevision: 0, value, operator: X }, { version: 1, expectedRevision: 0, operator: X }]) expect(parsePutSettingsRequest(input)).toBeNull();
    expect(String(parsePutSettingsRequest({ version: 1, expectedRevision: 0, value, operator: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })?.operator)).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    for (const operator of [null, "0x1234", `0x${"g".repeat(40)}`, `0X${"a".repeat(40)}`]) expect(parsePutSettingsRequest({ version: 1, expectedRevision: 0, value, operator })).toBeNull();
  });
  test("future-client response parsers accept typed responses", () => {
    expect(parseSettingsResponse({ version: 1, ...entry })).not.toBeNull();
    expect(parseAllSettingsResponse({ version: 1, domains: [entry] })).not.toBeNull();
    expect(parseAuditListResponse({ version: 1, entries: [], nextCursor: null })).not.toBeNull();
    expect(parseOperatorSettingsErrorResponse({ error: { code: "NOT_FOUND" } })).not.toBeNull();
    expect(parseOperatorSettingsErrorResponse({ error: { code: "OPERATOR_CHANGED" }, current: { version: 1, ...entry } })).toEqual({ error: { code: "OPERATOR_CHANGED" }, current: { version: 1, ...entry } });
  });
});

test("products writes require exactly the compiled catalog and successful PUT invalidates the offering", async () => {
  let transactions = 0;
  const products = deploymentProductSettings();
  const sql: SqlExecutor = {
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction: async () => { transactions++; throw new Error("Unexpected SQL write"); },
  };
  const realStore = new OperatorSettingsStore(sql);
  await expect(realStore.write({ domain: "products", value: { ...products, vaults: {} }, expectedRevision: 0, actor: X })).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  await expect(realStore.write({ domain: "products", value: { ...products, markets: { ...products.markets, [`0x${"c".repeat(64)}`]: "enabled" } }, expectedRevision: 0, actor: X })).rejects.toBeInstanceOf(OperatorSettingsValidationError);
  expect(transactions).toBe(0);
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  invalidateProductOffering();
  try {
    const first = await readProductOffering();
    const productsContext = { params: Promise.resolve({ domain: "products" }) };
    const store = { ...fakeStore, hasDomain: (domain: string) => domain === "products", write: async () => ({ domain: "products", settings: { value: products, revision: 1, source: "stored", updatedAt: null, updatedBy: X } }) } as unknown as OperatorSettingsStore;
    const result = await createSettingsDomainHandlers({ ...deps(), store: () => store }).PUT(request("PUT", "settings/products", { headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify({ version: 1, expectedRevision: 0, value: products, operator: X }) }), productsContext);
    expect(result.status).toBe(200);
    const saved = parseSettingsResponse(await result.json());
    expect(saved?.domain).toBe("products");
    expect(saved?.settings.value).toEqual(products);
    expect(saved?.settings.revision).toBe(1);
    expect(await readProductOffering()).not.toBe(first);
  } finally {
    invalidateProductOffering();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
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
      { result: createSettingsListHandler(dependencies)(request("GET", "settings")), parse: parseAllSettingsResponse },
      { result: createSettingsDomainHandlers(dependencies).GET(request(), context), parse: parseSettingsResponse },
      { result: createSettingsDomainHandlers(dependencies).PUT(put({ version: 1, expectedRevision: 0, value, operator: X }), context), parse: parseSettingsResponse },
      { result: createAuditListHandler(dependencies)(request("GET", "audit")), parse: parseAuditListResponse },
    ];
    for (const endpoint of endpoints) {
      const body = await response(await endpoint.result, variant.status);
      if (variant.code) expect(parseOperatorSettingsErrorResponse(body)?.error.code as string | undefined).toBe(variant.code);
      else expect(endpoint.parse(body)).not.toBeNull();
    }
  }
});
test("funding settings is a recognized domain for an operator", async () => {
  const funding = { domain: "funding", settings: { value: { corridors: [] }, revision: 0, source: "default" as const, updatedAt: null, updatedBy: null } };
  const store = Object.assign({}, fakeStore, { read: async () => funding, write: async () => funding });
  const fundingContext = { params: Promise.resolve({ domain: "funding" }) };
  const handler = createSettingsDomainHandlers({ ...deps(), store: () => store });
  expect(parseSettingsResponse(await response(await handler.GET(request("GET", "settings/funding"), fundingContext), 200))?.domain).toBe("funding");
  expect(parseSettingsResponse(await response(await handler.PUT(putDomain("funding", { version: 1, expectedRevision: 0, value: { corridors: [] }, operator: X }), fundingContext), 200))?.domain).toBe("funding");
});


test("domain auth precedes 404, and unknown domains return 404", async () => {
  const unknown = { params: Promise.resolve({ domain: "other" }) };
  expect(await response(await createSettingsDomainHandlers(deps()).GET(request(), unknown), 404)).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(await response(await createSettingsDomainHandlers(deps()).PUT(put({ version: 1, expectedRevision: 0, value }), unknown), 404)).toMatchObject({ error: { code: "NOT_FOUND" } });
});

test("PUT rejects cross-origin and malformed bodies before writing", async () => {
  let writes = 0;
  const store = { ...fakeStore, write: async (input: { value: unknown }) => { if (!parseSupportSettings(input.value)) throw new OperatorSettingsValidationError(); writes++; return entry; } } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(), store: () => store }).PUT;
  for (const req of [
    put({ version: 1, expectedRevision: 0, value }, { origin: "https://other.test" }),
    put({ version: 1, expectedRevision: 0, value }, { "sec-fetch-site": "cross-site" }),
    request("PUT", "settings/support", { headers: { "content-type": "application/json" }, body: "{}" }),
  ]) expect(await response(await handler(req, context), 403)).toMatchObject({ error: { code: "CROSS_ORIGIN" } });
  for (const req of [
    put({ version: 1, expectedRevision: 0, value }, { "content-type": "text/plain" }),
    request("PUT", "settings/support", { headers: { origin: "https://home.test", "content-type": "application/json" }, body: "{" }),
    put({ version: 1, expectedRevision: 0, value, operator: X, extra: 1 }),
    put({ version: 1, expectedRevision: 0, value: { email: "bad", url: null }, operator: X }),
    put({ version: 1, expectedRevision: 0, value }, { "content-length": "16385" }),
    put({ version: 1, expectedRevision: 0, value: { email: null, url: `https://example.com/${"x".repeat(16400)}` }, operator: X }),
  ]) expect(await response(await handler(req, context), 400)).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  expect(writes).toBe(0);
});

test("PUT rejects a different operator with current settings before writing", async () => {
  const writes: unknown[] = [];
  const store = { ...fakeStore, write: async (input: unknown) => { writes.push(input); return entry; } } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(async () => session(X)), store: () => store }).PUT;
  const body = await response(await handler(put({ version: 1, expectedRevision: 0, value, operator: Y }), context), 409);
  expect(parseOperatorSettingsErrorResponse(body)?.error.code).toBe("OPERATOR_CHANGED");
  expect(parseOperatorSettingsErrorResponse(body)?.current).toEqual({ version: 1, ...entry });
  expect(writes).toHaveLength(0);
});

test("PUT writes for a matching operator but rejects a missing operator without writing", async () => {
  const writes: unknown[] = [];
  const store = { ...fakeStore, write: async (input: unknown) => { writes.push(input); return entry; } } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(async () => session(X)), store: () => store }).PUT;
  expect(parseOperatorSettingsErrorResponse(await response(await handler(put({ version: 1, expectedRevision: 0, value }), context), 400))?.error.code).toBe("INVALID_REQUEST");
  expect(writes).toHaveLength(0);
  expect(parseSettingsResponse(await response(await handler(put({ version: 1, expectedRevision: 0, value, operator: X }), context), 200))).toEqual({ version: 1, ...entry });
  expect(writes).toEqual([{ domain: "support", value, expectedRevision: 0, actor: X }]);
});

test("conflicts include current revision; unavailable DB and corrupt values fail closed", async () => {
  const conflict = { ...fakeStore, write: async () => { throw new OperatorSettingsConflictError(); } } as unknown as OperatorSettingsStore;
  const unavailable = { ...fakeStore, readAll: async () => { throw new Error("database unavailable"); } } as unknown as OperatorSettingsStore;
  const invalid = { ...fakeStore, write: async () => { throw new OperatorSettingsValidationError(); } } as unknown as OperatorSettingsStore;
  const body = await response(await createSettingsDomainHandlers({ ...deps(), store: () => conflict }).PUT(put({ version: 1, expectedRevision: 0, value, operator: X }), context), 409);
  expect(parseOperatorSettingsErrorResponse(body)?.current?.settings.revision).toBe(0);
  expect(parseOperatorSettingsErrorResponse(body)?.error.code).toBe("SETTINGS_CONFLICT");
  expect(parseOperatorSettingsErrorResponse(await response(await createSettingsListHandler({ ...deps(), store: () => unavailable })(request()), 503))?.error.code).toBe("SETTINGS_UNAVAILABLE");
  expect(await response(await createSettingsDomainHandlers({ ...deps(), store: () => invalid }).PUT(put({ version: 1, expectedRevision: 0, value, operator: X }), context), 400)).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  expect(await response(await createAuditListHandler(deps())(request("GET", "audit?limit=0")), 400)).toMatchObject({ error: { code: "INVALID_REQUEST" } });
});

test("successful Invest writes invalidate visibility, but support writes and conflicts do not", async () => {
  let invalidations = 0;
  const investContext = { params: Promise.resolve({ domain: "invest" }) };
  const investValue = { hiddenCategories: ["stock"], hiddenAssets: ["cbbtc"] };
  const investEntry = { domain: "invest", settings: { value: investValue, revision: 1, source: "stored" as const, updatedAt: "2026-09-25T12:00:00.000Z", updatedBy: X } };
  const store = { ...fakeStore, hasDomain: (domain: string) => domain === "support" || domain === "invest", write: async ({ domain }: { domain: string }) => domain === "invest" ? investEntry : entry } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(), store: () => store, invalidateInvest: () => { invalidations++; } }).PUT;
  const investPut = () => request("PUT", "settings/invest", { headers: { origin: "https://home.test", "content-type": "application/json" }, body: JSON.stringify({ version: 1, expectedRevision: 0, value: investValue, operator: X }) });
  expect(parseSettingsResponse(await response(await handler(investPut(), investContext), 200))?.settings.value).toEqual(investValue);
  expect(invalidations).toBe(1);
  await response(await handler(put({ version: 1, expectedRevision: 0, value, operator: X }), context), 200);
  expect(invalidations).toBe(1);
  const conflict = { ...store, write: async () => { throw new OperatorSettingsConflictError(); }, read: async () => investEntry } as unknown as OperatorSettingsStore;
  await response(await createSettingsDomainHandlers({ ...deps(), store: () => conflict, invalidateInvest: () => { invalidations++; } }).PUT(investPut(), investContext), 409);
  expect(invalidations).toBe(1);
});

test("fees domain round-trips typed settings through the handler response", async () => {
  const writes: unknown[] = [];
  const store = {
    registry: OPERATOR_SETTINGS_DOMAINS,
    hasDomain: (domain: string) => domain === "fees",
    read: async () => feeEntry,
    readAll: async () => [feeEntry],
    write: async (input: { value: unknown }) => {
      const parsed = parseOperatorFeeSettings(input.value);
      if (!parsed) throw new OperatorSettingsValidationError();
      writes.push(parsed);
      return { ...feeEntry, settings: { ...feeEntry.settings, value: parsed, source: "stored" as const, revision: 1 } };
    },
  } as unknown as OperatorSettingsStore;
  const handlers = createSettingsDomainHandlers({ ...deps(), store: () => store });
  const readBody = await response(await handlers.GET(request("GET", "settings/fees"), feesContext), 200);
  const readParsed = parseSettingsResponse(readBody);
  expect(readParsed && parseOperatorFeeSettings(readParsed.settings.value)).toEqual(feeValue);
  const writeBody = await response(await handlers.PUT(putDomain("fees", { version: 1, expectedRevision: 0, value: feeValue, operator: X }), feesContext), 200);
  const writeParsed = parseSettingsResponse(writeBody);
  expect(writeParsed && parseOperatorFeeSettings(writeParsed.settings.value)).toEqual(feeValue);
  expect(writes).toEqual([feeValue]);
});

test("fees PUT rejects a value outside the operator fee contract", async () => {
  const store = {
    registry: OPERATOR_SETTINGS_DOMAINS,
    hasDomain: (domain: string) => domain === "fees",
    read: async () => feeEntry,
    readAll: async () => [feeEntry],
    write: async (input: { value: unknown }) => {
      if (!parseOperatorFeeSettings(input.value)) throw new OperatorSettingsValidationError();
      return feeEntry;
    },
  } as unknown as OperatorSettingsStore;
  const handler = createSettingsDomainHandlers({ ...deps(), store: () => store }).PUT;
  const body = await response(await handler(putDomain("fees", { version: 1, expectedRevision: 0, value: { trade: { bps: 301, recipient: feeValue.trade.recipient } }, operator: X }), feesContext), 400);
  expect(parseOperatorSettingsErrorResponse(body)?.error.code).toBe("INVALID_REQUEST");
});
