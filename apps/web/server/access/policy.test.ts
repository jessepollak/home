import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { issueAccessToken } from "./token";
import { enforceAccess } from "./policy";

const CREDENTIAL = "a".repeat(8);
const SIGNING_SECRET = "b".repeat(32);
const enabled = { kind: "enabled" as const, credential: CREDENTIAL, signingSecret: SIGNING_SECRET };
const now = new Date("2026-09-18T12:00:00.000Z");

function request(
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  return new NextRequest(`https://home.test${path}`, init);
}

describe("deployment access policy", () => {
  test("keeps only exact machine and access routes public", () => {
    const allowed = [
      "/.well-known/apple-developer-merchantid-domain-association",
      "/api/webhooks/cdp",
      "/api/funding/webhooks/ripio",
      "/access",
      "/api/access",
      "/api/access/logout",
      "/_next/static/chunks/access.js",
    ];
    for (const path of allowed) expect(enforceAccess(request(path), enabled, now)).toBeNull();

    const protectedNeighbors = [
      "/.well-known/apple-developer-merchantid-domain-association-other",
      "/.well-known/other",
      "/api/webhooks/cdp/other",
      "/api/funding/webhooks/ripio/extra",
      "/api/funding/webhooks/ripio%2Fextra",
      "/api/funding/webhooks",
      "/api/session",
      "/_next/image",
    ];
    for (const path of protectedNeighbors) {
      const expectedStatus = path.startsWith("/api/") ? 401 : 307;
      expect(enforceAccess(request(path), enabled, now)?.status, path).toBe(expectedStatus);
    }
  });

  test("redirects safe page GET and HEAD without depending on fetch metadata", () => {
    for (const method of ["GET", "HEAD"]) {
      const response = enforceAccess(request("/borrow?asset=usdc", { method }), enabled, now);
      expect(response?.status).toBe(307);
      expect(response?.headers.get("location")).toBe("https://home.test/access?next=%2Fborrow%3Fasset%3Dusdc");
      expect(response?.headers.get("cache-control")).toContain("private");
      expect(response?.headers.get("vary")).toContain("Cookie");
    }
  });

  test("returns typed JSON for private APIs and non-GET pages", async () => {
    for (const [path, method] of [["/api/session", "GET"], ["/borrow", "POST"]] as const) {
      const response = enforceAccess(request(path, { method }), enabled, now)!;
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ version: 1, error: { code: "ACCESS_REQUIRED" } });
    }
  });

  test("fails protected paths closed on misconfiguration but leaves machine and access pages reachable", async () => {
    expect(enforceAccess(request("/access"), { kind: "misconfigured" }, now)).toBeNull();
    expect(enforceAccess(request("/api/webhooks/cdp"), { kind: "misconfigured" }, now)).toBeNull();
    const response = enforceAccess(request("/api/session"), { kind: "misconfigured" }, now)!;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } });
  });

  test("allows a valid independent access cookie and makes the response private", () => {
    const token = issueAccessToken(enabled, now);
    const response = enforceAccess(request("/api/session", { headers: { cookie: `home-access=${token}` } }), enabled, now);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(response?.headers.get("cache-control")).toContain("private");
    expect(response?.headers.get("vary")).toContain("Cookie");
  });
});
