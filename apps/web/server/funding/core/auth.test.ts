import { describe, expect, test } from "bun:test";
import { fundingRequestOrigin } from "./auth";

describe("fundingRequestOrigin", () => {
  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  test("prefers the forwarded host the browser used over the bind address", () => {
    expect(fundingRequestOrigin(request("http://127.0.0.1:3000/api/funding/quotes", { "x-forwarded-host": "localhost:3000" }))).toBe("http://localhost:3000");
  });

  test("honours a forwarded https protocol", () => {
    expect(fundingRequestOrigin(request("http://10.0.0.5:3000/api/funding/orders", { "x-forwarded-host": "home.example", "x-forwarded-proto": "https" }))).toBe("https://home.example");
  });

  test("falls back to the request URL without forwarded headers", () => {
    expect(fundingRequestOrigin(request("https://home.example/api/funding/quotes"))).toBe("https://home.example");
  });

  test("ignores malformed forwarded values", () => {
    expect(fundingRequestOrigin(request("http://127.0.0.1:3000/x", { "x-forwarded-host": "evil.example/path?x", "x-forwarded-proto": "javascript" }))).toBe("http://127.0.0.1:3000");
    expect(fundingRequestOrigin(request("http://127.0.0.1:3000/x", { "x-forwarded-host": "a.example, b.example" }))).toBe("http://a.example");
  });

  test("falls back when the forwarded host cannot form a usable origin", () => {
    for (const host of ["localhost:99999", "-", ".."]) {
      expect(fundingRequestOrigin(request("http://127.0.0.1:3000/x", { "x-forwarded-host": host })), host).toBe("http://127.0.0.1:3000");
    }
  });
});
