import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { canonicalDevelopmentNavigationResponse, proxy } from "./proxy";

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

  test("does not redirect the apple pay domain association file in development", () => {
    const association = canonicalDevelopmentNavigationResponse(
      new NextRequest(
        "http://127.0.0.1:3000/.well-known/apple-developer-merchantid-domain-association",
        { headers: { ...navigationHeaders, host: "127.0.0.1:3000" } },
      ),
      "development",
    );
    expect(association.headers.get("location")).toBeNull();

    const neighbor = canonicalDevelopmentNavigationResponse(
      new NextRequest(
        "http://127.0.0.1:3000/.well-known/apple-developer-merchantid-domain-association-other",
        { headers: { ...navigationHeaders, host: "127.0.0.1:3000" } },
      ),
      "development",
    );
    expect(neighbor.headers.get("location")).toBe(
      "http://localhost:3000/.well-known/apple-developer-merchantid-domain-association-other",
    );
  });
});

test("proxy protects every admin path after deployment access and leaves other paths unchanged", () => {
  const prior = process.env.HOME_ACCESS_REQUIRED;
  try {
    delete process.env.HOME_ACCESS_REQUIRED;
    for (const path of ["/admin", "/admin/nope", "/api/admin/session", "/api/admin/nope"]) {
      const response = proxy(new NextRequest(`https://home.test${path}`));
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toContain("Cookie");
    }
    expect(proxy(new NextRequest("https://home.test/home")).headers.get("cache-control")).toBeNull();
    process.env.HOME_ACCESS_REQUIRED = "1";
    const protectedResponse = proxy(new NextRequest("https://home.test/admin/nope"));
    expect(protectedResponse.status).toBe(503);
    expect(protectedResponse.headers.get("cache-control")).toContain("no-store");
  } finally {
    if (prior === undefined) delete process.env.HOME_ACCESS_REQUIRED;
    else process.env.HOME_ACCESS_REQUIRED = prior;
  }
});
