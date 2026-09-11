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

  test("fails closed for quoted credential values truncated at the input boundary", () => {
    const canary = "quote-boundary-canary";
    const longUrl = `https://example.test/${"a".repeat(4_050)}`;
    const scrubbed = scrubString(`${longUrl} token="${canary}${"z".repeat(100)}"`);

    expect(scrubbed).toContain(REDACTED_URL);
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).not.toContain(canary);
    expect(scrubbed).not.toContain(canary.slice(0, 8));
  });

  test("redacts sensitive pathname keys and their following values in routes and messages", () => {
    const absoluteCanary = "absolute-path-canary";
    const relativeCanary = "relative-path-canary";

    expect(sanitizeRoutePath(`/reset/access_token/${absoluteCanary}/done`)).toBe(
      "/reset/:redacted/:redacted/done",
    );
    expect(sanitizeRoutePath(`/reset/access%5Ftoken/${absoluteCanary}`)).toBe(
      "/reset/:redacted/:redacted",
    );

    const scrubbed = scrubString(
      `failed at /reset/access_token/${absoluteCanary} and docs/client-secret/${relativeCanary}`,
    );
    expect(scrubbed).toContain("/reset/:redacted/:redacted");
    expect(scrubbed).toContain("docs/:redacted/:redacted");
    expect(scrubbed).not.toContain(absoluteCanary);
    expect(scrubbed).not.toContain(relativeCanary);
  });

  test("recursively decodes path keys and scrubs bracket- and brace-wrapped references", () => {
    const absoluteCanary = "short-absolute-canary";
    const relativeCanary = "short-relative-canary";

    expect(sanitizeRoutePath(`/reset/%2574oken/${absoluteCanary}`)).toBe(
      "/reset/:redacted/:redacted",
    );
    expect(sanitizeRoutePath(`/reset/%ZZ/${absoluteCanary}`)).toBe(
      "/reset/:redacted/:redacted",
    );
    expect(sanitizeRoutePath(`/reset/%25252574oken/${absoluteCanary}`)).toBe(
      "/reset/:redacted/:redacted",
    );

    const scrubbed = scrubString(
      `[/reset/%2574oken/${absoluteCanary}] {docs/%2574oken/${relativeCanary}}`,
    );
    expect(scrubbed).toBe(
      "[/reset/:redacted/:redacted] {docs/:redacted/:redacted}",
    );
    expect(scrubbed).not.toContain(absoluteCanary);
    expect(scrubbed).not.toContain(relativeCanary);
  });

  test("redacts complete credential headers and structured sensitive values", () => {
    const headerOne = "header-first-canary";
    const headerTwo = "header-second-canary";
    const arrayOne = "array-first-canary";
    const arrayTwo = "array-second-canary";
    const objectOne = "object-first-canary";
    const objectTwo = "object-second-canary";
    const scrubbed = scrubString(
      [
        `Authorization: Scheme ${headerOne}, Alternate ${headerTwo}`,
        JSON.stringify({
          accessToken: [arrayOne, arrayTwo],
          clientSecret: { primary: objectOne, nested: { value: objectTwo } },
          safe: "retained",
        }),
      ].join("\n"),
    );

    for (const canary of [headerOne, headerTwo, arrayOne, arrayTwo, objectOne, objectTwo]) {
      expect(scrubbed).not.toContain(canary);
    }
    expect(scrubbed).toContain(`Authorization: ${REDACTED}`);
    expect(scrubbed).toContain('"accessToken":[REDACTED]');
    expect(scrubbed).toContain('"clientSecret":[REDACTED]');
    expect(scrubbed).toContain('"safe":"retained"');
  });

  test("removes secrets from relative, query-only, and fragment-only references", () => {
    const canaries = [
      "relative-query-canary",
      "query-only-canary",
      "fragment-only-canary",
      "relative-fragment-canary",
    ];
    const scrubbed = scrubString(
      `settings?token=${canaries[0]} ?token=${canaries[1]} #${canaries[2]} docs/account/page#${canaries[3]}`,
    );

    for (const canary of canaries) expect(scrubbed).not.toContain(canary);
    expect(scrubbed).toBe(`settings ${REDACTED_URL} ${REDACTED_URL} docs/account/page`);
  });
});
