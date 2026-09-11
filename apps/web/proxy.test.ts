import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { canonicalDevelopmentNavigationResponse } from "./proxy";

const navigationHeaders = {
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};

function request(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    ...init,
    headers: { host: "localhost:3000", ...init.headers },
  });
}

async function expectDirectSaveQa404(response: Response, method = "GET") {
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBeNull();
  expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  expect(await response.text()).toBe(method === "HEAD" ? "Not found.\n" : "Not found.\n");
}

describe("Save QA namespace proxy gate", () => {
  test("returns one direct response for production and disabled development transports and methods", async () => {
    const transports: Array<Record<string, string>> = [
      {},
      navigationHeaders,
      { RSC: "1", Accept: "text/x-component" },
      { "next-router-prefetch": "1", purpose: "prefetch" },
    ];
    for (const environment of ["production", "development"] as const) {
      for (const method of ["GET", "HEAD", "POST"] as const) {
        for (const headers of transports) {
          await expectDirectSaveQa404(
            canonicalDevelopmentNavigationResponse(
              request("/dev/save-qa", { method, headers }),
              environment,
              environment === "production" ? "1" : "0",
            ),
            method,
          );
        }
      }
    }
  });

  test("covers trailing, descendant, encoded, case, repeated-slash, and backslash namespace variants", async () => {
    const variants = [
      "/dev/save-qa/",
      "/dev/save-qa/child",
      "/DEV/SAVE-QA",
      "/dev//save-qa",
      "//dev/save-qa",
      "/dev/%73ave-qa",
      "/dev/save%2Dqa",
      "/dev/save-qa%2Fchild",
      "/dev%5Csave-qa",
      "/dev/save-qa%5Cchild",
    ];
    for (const path of variants) {
      await expectDirectSaveQa404(
        canonicalDevelopmentNavigationResponse(request(path), "production", "1"),
      );
    }
  });

  test("does not capture nearby unrelated routes and permits only explicit enabled development", async () => {
    for (const path of [
      "/dev/save-q",
      "/dev/save-qax",
      "/dev/save",
      "/dev/add-money-qa",
      "/dashboard",
    ]) {
      const response = canonicalDevelopmentNavigationResponse(request(path), "production", "1");
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }

    const enabled = canonicalDevelopmentNavigationResponse(
      request("/dev/save-qa", { headers: navigationHeaders }),
      "development",
      "1",
    );
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("x-middleware-next")).toBe("1");
  });
});

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
