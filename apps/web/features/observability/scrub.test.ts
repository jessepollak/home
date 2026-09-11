import { describe, expect, test } from "bun:test";
import {
  REDACTED,
  REDACTED_URL,
  isSensitiveKey,
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "./scrub";

const forbidden = [
  "raw-access-value",
  "cookie-value",
  "client-secret-value",
  "cdp-secret-value",
  "847291",
  "correct horse battery staple",
  "user@example.com",
  "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  "superlongmixedtoken1234567890",
  "query-secret",
  "hash-secret",
];

describe("observability scrub security matrix", () => {
  test("scrubs JSON, assignment, header, token, OTP, email, URL, and key material forms", () => {
    const input = [
      'Authorization: Bearer raw-access-value',
      'Cookie: session=cookie-value',
      '{"accessToken":"raw-access-value","client_secret":"client-secret-value"}',
      "CDP_API_KEY_SECRET=cdp-secret-value",
      "otp: 847291",
      'password="correct horse battery staple"',
      "user@example.com",
      "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "token=superlongmixedtoken1234567890",
      "https://example.com/private?token=query-secret#hash-secret",
      "/activity?token=query-secret#hash-secret",
      '{"url":"/private?value=query-secret#hash-secret"}',
      "-----BEGIN PRIVATE KEY----- private bytes -----END PRIVATE KEY-----",
      "ACTIVITY_UNAVAILABLE TypeError",
    ].join("\n");

    const scrubbed = scrubString(input);

    for (const value of forbidden) expect(scrubbed).not.toContain(value);
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).toContain(REDACTED_URL);
    expect(scrubbed).toContain("/activity");
    expect(scrubbed).toContain("ACTIVITY_UNAVAILABLE TypeError");
  });

  test("recognizes common snake, kebab, camel, and CDP credential keys", () => {
    for (const key of [
      "authorization",
      "set-cookie",
      "access_token",
      "refreshToken",
      "apiKey",
      "client-secret",
      "oneTimeCode",
      "CDP_API_KEY_SECRET",
      "password",
    ]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
    expect(isSensitiveKey("errorCode")).toBe(false);
  });

  test("keeps only a bounded pathname and redacts risky path segments", () => {
    expect(sanitizeRoutePath("/activity?token=secret#fragment")).toBe("/activity");
    expect(sanitizeRoutePath("https://evil.example/private?token=x")).toBe("/");
    expect(sanitizeRoutePath("//evil.example/private")).toBe("/");
    expect(sanitizeRoutePath("/account/0x1234567890abcdef1234/details")).toBe(
      "/account/:redacted/details",
    );
    expect(sanitizeRoutePath("/reset/rawMixedToken12345678901234567890")).toBe(
      "/reset/:redacted",
    );
    expect(sanitizeRoutePath("/invest/ethereum")).toBe("/invest/ethereum");
  });

  test("allows only compact identifiers", () => {
    expect(sanitizeIdentifier("TypeError", "Error")).toBe("TypeError");
    expect(sanitizeIdentifier("authorization=secret", "Error")).toBe("Error");
    expect(sanitizeIdentifier("bad name with spaces", "Error")).toBe("Error");
  });
});
