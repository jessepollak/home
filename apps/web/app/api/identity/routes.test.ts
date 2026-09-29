import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { HOME_SESSION_COOKIE, signedValue } from "@/server/auth/native-base-session";
import { identityFailure } from "@/server/identity/http";
import { IdentityConfigurationError, IdentityConflict, IdentityRateLimited } from "@/server/identity/service";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { mapIdentityStatus } from "@/shared/identity/status";
import { GET as status } from "./verification/route";
import { POST as session } from "./verification/session/route";
import { POST as link } from "./verification/link/route";

const origin = "https://home.test";
const routes = [
  ["/api/identity/verification", "GET", status],
  ["/api/identity/verification/session", "POST", session],
  ["/api/identity/verification/link", "POST", link],
] as const;

function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("vary")).toContain("Authorization");
  expect(response.headers.get("vary")).toContain(ACCOUNT_PROVIDER_HEADER);
}

describe("identity route rejection", () => {
  test("all private routes reject missing sessions with private headers", async () => {
    for (const [path, method, handler] of routes) {
      const response = await handler(new Request(`${origin}${path}`, {
        method,
        ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
      }));
      expect(response.status, path).toBe(401);
      expect(await response.json(), path).toEqual({ error: { code: "UNAUTHENTICATED", message: "A valid access token is required." } });
      assertPrivate(response);
    }
  });

  test("failure mapping preserves conflict status and distinguishes configuration and transient failures", async () => {
    const current = mapIdentityStatus(null, "home-level");
    for (const [error, httpStatus, code, statusBody] of [
      [new IdentityConflict(current), 409, "IDENTITY_STATE_CONFLICT", current],
      [new IdentityConflict(current, true), 400, "CONSENT_REQUIRED", current],
      [new IdentityConfigurationError(), 503, "IDENTITY_CONFIGURATION_UNAVAILABLE", undefined],
      [new Error("private provider detail"), 503, "IDENTITY_TEMPORARILY_UNAVAILABLE", undefined],
    ] as const) {
      const response = identityFailure(error);
      expect(response.status).toBe(httpStatus);
      const body = await response.json() as { error: { code: string; message: string }; status?: unknown };
      expect(body.error.code).toBe(code);
      expect(body.error.message).not.toContain("private provider detail");
      expect(body.status).toEqual(statusBody);
      assertPrivate(response);
    }
  });

  test("rate limit response uses 429 and Retry-After", async () => {
    const response = identityFailure(new IdentityRateLimited(42));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toMatchObject({ error: { code: "IDENTITY_RATE_LIMITED" } });
  });

  test("authenticated session route rejects invalid request bodies", async () => {
    const previousSecret = process.env.HOME_SESSION_SECRET;
    const secret = "synthetic-identity-route-session-secret-value";
    process.env.HOME_SESSION_SECRET = secret;
    try {
      const address = "0x1111111111111111111111111111111111111111";
      const subject = `base-${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
      const token = signedValue(Buffer.from(secret), JSON.stringify({
        version: 1,
        session: { user: { subject }, smartAccount: { address, chainId: 8453 }, accountProvider: "base-account" },
        issuedAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }));
      for (const body of ["{", "[]", '{"consent":false}', '{"unexpected":true}']) {
        const response = await session(new Request(`${origin}/api/identity/verification/session`, {
          method: "POST",
          headers: { "content-type": "application/json", [ACCOUNT_PROVIDER_HEADER]: "base-account", Cookie: `${HOME_SESSION_COOKIE}=${token}` },
          body,
        }));
        expect(response.status, body).toBe(400);
        expect(await response.json(), body).toEqual({ error: { code: "INVALID_IDENTITY_REQUEST", message: "Invalid verification request." } });
        assertPrivate(response);
      }
    } finally {
      if (previousSecret === undefined) delete process.env.HOME_SESSION_SECRET;
      else process.env.HOME_SESSION_SECRET = previousSecret;
    }
  });
});
