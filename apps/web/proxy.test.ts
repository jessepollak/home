import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { canonicalDevelopmentNavigationResponse } from "./proxy";

const navigationHeaders = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};

describe("development canonical host proxy", () => {
  test("redirects only 127.0.0.1 document navigation and uses the actual Host header to avoid loops", () => {
    const redirect = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://localhost:3000/borrow?asset=usdc", {
        headers: { ...navigationHeaders, host: "127.0.0.1:3000" },
      }),
      "development",
    );
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe(
      "http://localhost:3000/borrow?asset=usdc",
    );

    const canonical = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://127.0.0.1:3000/borrow?asset=usdc", {
        headers: { ...navigationHeaders, host: "localhost:3000" },
      }),
      "development",
    );
    expect(canonical.headers.get("location")).toBeNull();

    const apiNavigation = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://127.0.0.1:3000/api/session", {
        headers: { ...navigationHeaders, host: "127.0.0.1:3000" },
      }),
      "development",
    );
    expect(apiNavigation.headers.get("location")).toBeNull();

    const documentPost = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://127.0.0.1:3000/borrow", {
        method: "POST",
        headers: { ...navigationHeaders, host: "127.0.0.1:3000" },
      }),
      "development",
    );
    expect(documentPost.headers.get("location")).toBeNull();

    const subresource = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://127.0.0.1:3000/borrow", {
        headers: { host: "127.0.0.1:3000" },
      }),
      "development",
    );
    expect(subresource.headers.get("location")).toBeNull();

    const production = canonicalDevelopmentNavigationResponse(
      new NextRequest("http://127.0.0.1:3000/borrow", {
        headers: { ...navigationHeaders, host: "127.0.0.1:3000" },
      }),
      "production",
    );
    expect(production.headers.get("location")).toBeNull();
  });
});
