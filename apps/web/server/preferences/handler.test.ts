import { describe, expect, test } from "bun:test";
import { parseCountryPreferenceReadResponse, parseCountryPreferenceRequest, parseCountryPreferenceResponse } from "@/shared/account/contracts/country-preference";
import { createCountryPreferenceHandler, createCountryPreferenceReadHandler } from "./handler";

const session = { accountProvider: "cdp-embedded" as const, user: { subject: "test" }, smartAccount: null };
const request = (body: unknown) => new Request("https://home.test/api/account/country-preference", {
  method: "PUT", headers: { "X-Home-Account-Provider": "cdp-embedded" }, body: JSON.stringify(body),
});

describe("country preference handler", () => {
  test("request and response parsers reject GLOBAL", () => {
    expect(parseCountryPreferenceRequest({ version: 1, regionId: "GLOBAL" })).toBeNull();
    expect(parseCountryPreferenceResponse({ version: 1, regionId: "GLOBAL" })).toBeNull();
  });
  test("read parser accepts null and supported countries but rejects invalid values", () => {
    expect(parseCountryPreferenceReadResponse({ version: 1, regionId: null })).toEqual({ version: 1, regionId: null });
    expect(parseCountryPreferenceReadResponse({ version: 1, regionId: "GB" })).toEqual({ version: 1, regionId: "GB" });
    expect(parseCountryPreferenceReadResponse({ version: 1, regionId: "GLOBAL" })).toBeNull();
    expect(parseCountryPreferenceReadResponse({ version: 1 })).toBeNull();
    expect(parseCountryPreferenceReadResponse({ version: 2, regionId: null })).toBeNull();
  });

  test("rejects unauthenticated reads without reaching the store", async () => {
    let called = false;
    const handler = createCountryPreferenceReadHandler({
      authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in." } }, { status: 401 }),
      read: async () => { called = true; return "US"; },
    });
    expect((await handler(new Request("https://home.test/api/account/country-preference"))).status).toBe(401);
    expect(called).toBe(false);
  });

  test.each(["DE", null] as const)("reads saved country preference %s privately", async (stored) => {
    const calls: unknown[] = [];
    const handler = createCountryPreferenceReadHandler({ authorize: async () => session, read: async (authorized) => {
      calls.push(authorized);
      return stored;
    } });
    const response = await handler(new Request("https://home.test/api/account/country-preference"));
    expect(await response.json()).toEqual({ version: 1, regionId: stored });
    expect(calls).toEqual([session]);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("returns a private 503 when a preference read fails", async () => {
    const handler = createCountryPreferenceReadHandler({ authorize: async () => session, read: async () => { throw new Error("db"); } });
    const response = await handler(new Request("https://home.test/api/account/country-preference"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("private");
    expect((await response.json()).error.code).toBe("COUNTRY_PREFERENCE_UNAVAILABLE");
  });

  test("rejects unauthenticated writes without reaching the store", async () => {
    let called = false;
    const handler = createCountryPreferenceHandler({
      authorize: async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in." } }, { status: 401 }),
      write: async () => { called = true; return "US"; },
    });
    expect((await handler(request({ version: 1, regionId: "GB" }))).status).toBe(401);
    expect(called).toBe(false);
  });

  test("validates input and forwards adoption flag with authenticated session", async () => {
    const calls: unknown[] = [];
    const handler = createCountryPreferenceHandler({ authorize: async () => session, write: async (...args) => {
      calls.push(args); return "DE";
    } });
    expect((await handler(request({ version: 9, regionId: "GB" }))).status).toBe(400);
    expect((await handler(request({ version: 1, regionId: "ZZ" }))).status).toBe(400);
    expect((await handler(request({ version: 1, regionId: "GLOBAL" }))).status).toBe(400);
    const response = await handler(request({ version: 1, regionId: "GB", adopt: true }));
    expect(await response.json()).toEqual({ version: 1, regionId: "DE" });
    expect(calls).toEqual([[session, "GB", { onlyIfUnset: true }]]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("returns a private service error when persistence fails", async () => {
    const handler = createCountryPreferenceHandler({ authorize: async () => session, write: async () => { throw new Error("db"); } });
    const response = await handler(request({ version: 1, regionId: "GB" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
