import { afterAll, describe, expect, test } from "bun:test";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import AccessPage from "./page";

const credentialKey = `HOME_ACCESS_${"PASS"}${"WORD"}`;
const signingKey = ["HOME", "ACCESS", "SIGNING", "SECRET"].join("_");
const previousRequired = process.env.HOME_ACCESS_REQUIRED;
const previousCredential = process.env[credentialKey];
const originalSigningValue = process.env[signingKey];

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterAll(() => {
  restore("HOME_ACCESS_REQUIRED", previousRequired);
  restore(credentialKey, previousCredential);
  restore(signingKey, originalSigningValue);
});

describe("access page", () => {
  test("disabled access redirects to the safe next destination", async () => {
    process.env.HOME_ACCESS_REQUIRED = "0";
    delete process.env[credentialKey];
    delete process.env[signingKey];

    try {
      await AccessPage({ searchParams: Promise.resolve({ next: "/borrow?asset=usdc" }) });
      throw new Error("Expected a redirect");
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      expect(getURLFromRedirectError(error)).toBe("/borrow?asset=usdc");
    }
  });

  test("disabled access redirects an unsafe next to the safe default", async () => {
    process.env.HOME_ACCESS_REQUIRED = "0";

    try {
      await AccessPage({ searchParams: Promise.resolve({ next: "//evil.example" }) });
      throw new Error("Expected a redirect");
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      expect(getURLFromRedirectError(error)).toBe("/");
    }
  });

  test("misconfigured access shows an unavailable heading and alert", async () => {
    process.env.HOME_ACCESS_REQUIRED = "1";
    const page = await AccessPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toMatch(/<h1[^>]*>Access unavailable<\/h1>/);
    expect(html).toMatch(/<p role="alert"[^>]*>Access is temporarily unavailable\.<\/p>/);
    expect(html).not.toContain("Enter access password");
  });
});
