import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { readAccessConfig } from "./config";
import { enforceAccess } from "./policy";
import { issueAccessToken } from "./token";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;
const signingSecretKey = "HOME_ACCESS_SIGNING_SECRET";

function environment(
  required: string | undefined,
  credential?: string,
  signingSecret?: string,
): Record<string, string | undefined> {
  return {
    ...(required === undefined ? {} : { HOME_ACCESS_REQUIRED: required }),
    ...(credential === undefined ? {} : { [credentialKey]: credential }),
    ...(signingSecret === undefined ? {} : { [signingSecretKey]: signingSecret }),
  };
}

describe("deployment access configuration", () => {
  test("is disabled unless explicitly required", () => {
    expect(readAccessConfig({})).toEqual({ kind: "disabled" });
    expect(readAccessConfig(environment("0", "a".repeat(8), "b".repeat(32))))
      .toEqual({ kind: "disabled" });
  });

  test("throws a clear error when exactly one credential value is set", () => {
    const message = `${credentialKey} and ${signingSecretKey} must be set together.`;
    expect(() => readAccessConfig(environment(undefined, "a".repeat(8))))
      .toThrow(message);
    expect(() => readAccessConfig(environment(undefined, undefined, "b".repeat(32))))
      .toThrow(message);
  });

  test("fails closed when a required credential is shorter than 8 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1", `${"🔐"}${"a".repeat(3)}`, "b".repeat(32))))
      .toEqual({ kind: "misconfigured" });
  });

  test("fails closed when a required signing secret is shorter than 32 UTF-8 bytes", () => {
    expect(readAccessConfig(environment("1", "a".repeat(8), "b".repeat(31))))
      .toEqual({ kind: "misconfigured" });
  });

  test("accepts the 8-byte credential and 32-byte signing secret boundaries", () => {
    const credential = "🔐".repeat(2);
    const signingSecret = "b".repeat(32);
    expect(readAccessConfig(environment("1", credential, signingSecret)))
      .toEqual({ kind: "enabled", credential, signingSecret });
  });

  test("a required gate with only one of the two values answers 503 without throwing, while a full configuration admits a valid token", async () => {
    const now = new Date("2026-09-18T12:00:00.000Z");
    const page = () => new NextRequest("https://home.test/borrow");
    const api = () => new NextRequest("https://home.test/api/session");
    for (const partial of [environment("1", "a".repeat(8)), environment("1", undefined, "b".repeat(32))]) {
      expect(readAccessConfig(partial)).toEqual({ kind: "misconfigured" });
      for (const blocked of [page(), api()]) {
        const response = enforceAccess(blocked, readAccessConfig(partial), now);
        expect(response?.status).toBe(503);
        expect(await response?.json()).toEqual({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } });
      }
      expect(enforceAccess(new NextRequest("https://home.test/api/webhooks/cdp"), readAccessConfig(partial), now)).toBeNull();
    }
    const full = readAccessConfig(environment("1", "a".repeat(8), "b".repeat(32)));
    if (full.kind !== "enabled") throw new Error("expected an enabled configuration");
    const token = issueAccessToken(full, now);
    expect(enforceAccess(new NextRequest("https://home.test/api/session", { headers: { cookie: `home-access=${token}` } }), full, now)?.status).toBe(200);
  });
});
