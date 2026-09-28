import { describe, expect, test } from "bun:test";
import { BASE_CHAIN_ID, type VerifiedAccountSession } from "@/shared/account/session-types";
import { BRAND_DEFAULTS, brandSettingsPutRequest, parseBrandSettingsResponse } from "@/shared/operator-branding/contract";
import { OPERATOR_SETTINGS_DOMAINS, parseOperatorSettingsErrorResponse, type OperatorSettingsErrorCode, type SettingsEntry } from "@/shared/operator-settings/contract";
import { readOperatorConfig } from "@/server/operator/config";
import { resolveBrand } from "./brand";
import { createSettingsDomainHandlers } from "./handlers";
import { OperatorSettingsStore, OperatorSettingsValidationError } from "./store";

const actor = "0x1111111111111111111111111111111111111111" as const;
const other = "0x2222222222222222222222222222222222222222" as const;
const value = { displayName: "Home Plus", description: "A place for money", primaryColor: "#000000", backgroundColor: "#0052ff" };
const context = { params: Promise.resolve({ domain: "brand" }) };
const session = (address: typeof actor | typeof other | null): VerifiedAccountSession => ({
  user: { subject: "operator" }, smartAccount: address ? { address, chainId: BASE_CHAIN_ID } : null,
  accountProvider: address ? "base-account" : "cdp-embedded",
});
const entry = (settings: typeof value | typeof BRAND_DEFAULTS, source: "default" | "stored" = "default"): SettingsEntry => ({
  domain: "brand", settings: { value: settings, revision: source === "stored" ? 1 : 0, source, updatedAt: null, updatedBy: null },
});
const get = () => new Request("https://home.test/api/admin/settings/brand");
const put = (settings: unknown = value, origin = "https://home.test") => new Request("https://home.test/api/admin/settings/brand", {
  method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ version: 1, expectedRevision: 0, value: settings }),
});
async function check(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return response.json();
}
async function brandResponse(response: Response) {
  const parsed = parseBrandSettingsResponse(await check(response, 200));
  expect(parsed).not.toBeNull();
  return parsed!;
}
async function errorCode(response: Response, status: number) {
  return parseOperatorSettingsErrorResponse(await check(response, status))?.error.code;
}

describe("brand resolver", () => {
  test("default and stored settings derive their own tokens", async () => {
    const defaults = await resolveBrand({ store: () => ({ read: async () => entry(BRAND_DEFAULTS) }) });
    expect(defaults).toEqual({ source: "default", settings: BRAND_DEFAULTS, tokens: { primaryForeground: "#ffffff", backgroundForeground: "#000000" } });
    const stored = await resolveBrand({ store: () => ({ read: async () => entry(value, "stored") }) });
    expect(stored).toEqual({ source: "stored", settings: value, tokens: { primaryForeground: "#ffffff", backgroundForeground: "#ffffff" } });
  });
  test("unavailable, corrupt and newer-version stores fall back without writing", async () => {
    const failed = await resolveBrand({ store: () => ({ read: async () => { throw new Error("query failed"); } }) });
    const corrupt = await resolveBrand({ store: () => ({ read: async () => entry({ ...value, primaryColor: "invalid" }) }) });
    const newerVersion = await resolveBrand({ store: () => new OperatorSettingsStore({
      query: async <T>() => ({ rows: [{ domain: "brand", schema_version: 2, value, revision: "1", updated_at: new Date(), updated_by: actor } as unknown as T], rowCount: 1 }),
      transaction: async () => { throw new Error("must not write"); },
    }) });
    const priorUrl = process.env.DATABASE_URL;
    let missingEnv;
    try {
      delete process.env.DATABASE_URL;
      missingEnv = await resolveBrand();
    } finally {
      if (priorUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorUrl;
    }
    for (const result of [failed, corrupt, newerVersion, missingEnv]) expect(result).toEqual({ source: "fallback", settings: BRAND_DEFAULTS, tokens: { primaryForeground: "#ffffff", backgroundForeground: "#000000" } });
  });
});

test("brand handlers read and write for the operator with private responses", async () => {
  let current = entry(BRAND_DEFAULTS);
  let writes = 0;
  const store = {
    registry: OPERATOR_SETTINGS_DOMAINS, hasDomain: (domain: string) => domain === "brand",
    read: async () => current,
    write: async (input: { value: unknown; expectedRevision: number }) => {
      writes++;
      if (input.expectedRevision !== 0 || !OPERATOR_SETTINGS_DOMAINS.brand.parse(input.value)) throw new OperatorSettingsValidationError();
      current = entry(value, "stored");
      return current;
    },
  } as unknown as OperatorSettingsStore;
  const handlers = createSettingsDomainHandlers({ authorize: async () => session(actor), config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: actor }), store: () => store });
  expect((await brandResponse(await handlers.GET(get(), context))).settings).toMatchObject({ value: BRAND_DEFAULTS, revision: 0, source: "default" });
  expect((await brandResponse(await handlers.PUT(put(), context))).settings).toMatchObject({ value, revision: 1, source: "stored" });
  expect((await brandResponse(await handlers.GET(get(), context))).settings).toMatchObject({ value, revision: 1, source: "stored" });
  expect(writes).toBe(1);
  expect(brandSettingsPutRequest(0, value)).toEqual({ version: 1, expectedRevision: 0, value });
});

test("brand handlers reject unauthorized and invalid requests without writes", async () => {
  let writes = 0;
  const store = {
    registry: OPERATOR_SETTINGS_DOMAINS, hasDomain: (domain: string) => domain === "brand",
    read: async () => entry(BRAND_DEFAULTS), write: async () => { writes++; return entry(value, "stored"); },
  } as unknown as OperatorSettingsStore;
  const handler = (authorize: () => Promise<VerifiedAccountSession | Response>, config = () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: actor })) =>
    createSettingsDomainHandlers({ authorize, config, store: () => store });
  const cases: { handlers: ReturnType<typeof handler>; status: number; code: OperatorSettingsErrorCode }[] = [
    { handlers: handler(async () => Response.json({}, { status: 401 })), status: 401, code: "UNAUTHENTICATED" },
    { handlers: handler(async () => session(null)), status: 403, code: "OPERATOR_FORBIDDEN" },
    { handlers: handler(async () => session(other)), status: 403, code: "OPERATOR_FORBIDDEN" },
    { handlers: handler(async () => session(actor), () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: "0x1234" })), status: 403, code: "OPERATOR_FORBIDDEN" },
  ];
  for (const item of cases) {
    expect(await errorCode(await item.handlers.GET(get(), context), item.status)).toBe(item.code);
    expect(await errorCode(await item.handlers.PUT(put(), context), item.status)).toBe(item.code);
  }
  const operator = handler(async () => session(actor));
  expect(await errorCode(await operator.PUT(put(value, "https://foreign.test"), context), 403)).toBe("CROSS_ORIGIN");
  for (const invalid of [{ ...value, displayName: "" }, { ...value, primaryColor: "red" }, { ...value, extra: "not allowed" }]) {
    expect(await errorCode(await operator.PUT(put(invalid), context), 400)).toBe("INVALID_REQUEST");
  }
  expect(writes).toBe(0);
});

test("brand handlers return private 503 responses when storage is unavailable", async () => {
  const handlers = createSettingsDomainHandlers({
    authorize: async () => session(actor), config: () => readOperatorConfig({ HOME_OPERATOR_ADDRESSES: actor }),
    store: () => { throw new Error("DATABASE_URL is required"); },
  });
  expect(await errorCode(await handlers.GET(get(), context), 503)).toBe("SETTINGS_UNAVAILABLE");
  expect(await errorCode(await handlers.PUT(put(), context), 503)).toBe("SETTINGS_UNAVAILABLE");
});
