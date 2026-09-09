import { describe, expect, test } from "bun:test";
import {
  REDACTED,
  isSensitiveKey,
  sanitizePathname,
  scrubString,
  scrubValue,
} from "./scrub";

describe("observability scrub", () => {
  test("redacts JWTs, bearer tokens, OTPs, emails, and secret assignments", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";
    const input = [
      `Authorization: Bearer ${jwt}`,
      `access_token=${jwt}`,
      "otp=123456",
      "one_time_code: 847291",
      "user@example.com reported ACTIVITY_UNAVAILABLE",
      "/api/session?code=abc123&cursor=ok",
    ].join(" ");

    const scrubbed = scrubString(input);

    expect(scrubbed).not.toContain(jwt);
    expect(scrubbed).not.toContain("123456");
    expect(scrubbed).not.toContain("847291");
    expect(scrubbed).not.toContain("user@example.com");
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).toContain("ACTIVITY_UNAVAILABLE");
    expect(scrubbed).toContain("cursor=ok");
  });

  test("redacts sensitive object keys without walking CDP payloads into logs", () => {
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("CDP_API_KEY_SECRET")).toBe(true);
    expect(isSensitiveKey("errorCode")).toBe(false);

    expect(
      scrubValue({
        errorCode: "UNAUTHENTICATED",
        authorization: "Bearer secret-token",
        nested: { otp: "111222", message: `token=eyJhbGciOiJIUzI1NiJ9.a.b` },
      }),
    ).toEqual({
      errorCode: "UNAUTHENTICATED",
      authorization: REDACTED,
      nested: { otp: REDACTED, message: `token=${REDACTED}` },
    });
  });

  test("drops query strings from pathnames", () => {
    expect(sanitizePathname("/api/session?token=secret#hash")).toBe("/api/session");
    expect(sanitizePathname("https://evil.example/steal")).toBe("/");
  });
});
