import { describe, expect, test } from "bun:test";
import { createAccessLoginHandler, createAccessLogoutHandler } from "./handlers";

const CREDENTIAL = "a".repeat(32);
const field = ["pass", "word"].join("");
function body(value: string, next = "/") {
  const form = new URLSearchParams();
  form.set(field, value);
  form.set("next", next);
  return form.toString();
}
function request(formBody: string, headers: Record<string, string> = {}) {
  return new Request("https://home.test/api/access", {
    method: "POST",
    headers: {
      origin: "https://home.test",
      host: "home.test",
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: formBody,
  });
}

describe("access login", () => {
  const handle = createAccessLoginHandler({
    getConfig: () => ({ kind: "enabled", credential: CREDENTIAL }),
    now: () => new Date("2026-09-18T12:00:00.000Z"),
  });

  test("sets only the access cookie and redirects to a safe destination", async () => {
    const response = await handle(request(body(CREDENTIAL, "/borrow?asset=usdc")));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://home.test/borrow?asset=usdc");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("home-access=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("home-session");
  });

  test("returns generic bounded failures with no cookie", async () => {
    const duplicate = new URLSearchParams(body(CREDENTIAL));
    duplicate.append(field, CREDENTIAL);
    const cases = [
      request(body("wrong")),
      request(duplicate.toString()),
      request(body(CREDENTIAL), { origin: "https://attacker.test" }),
      request(body(CREDENTIAL), { "content-length": "5000" }),
      new Request("https://home.test/api/access", { method: "GET" }),
    ];
    for (const item of cases) {
      const response = await handle(item);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("vary")).toContain("Cookie");
      expect(await response.json()).toEqual({ version: 1, error: { code: "INVALID_ACCESS" } });
    }
  });

  test("fails closed without exposing configuration detail", async () => {
    const unavailable = createAccessLoginHandler({ getConfig: () => ({ kind: "misconfigured" }) });
    const response = await unavailable(request(body(CREDENTIAL)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ version: 1, error: { code: "ACCESS_UNAVAILABLE" } });
  });
});

describe("access logout", () => {
  test("clears only deployment access and rejects cross-origin posts", async () => {
    const handle = createAccessLogoutHandler();
    const response = await handle(new Request("https://home.test/api/access/logout", {
      method: "POST",
      headers: { origin: "https://home.test", host: "home.test", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://home.test/access");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("home-access=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("home-session");

    const rejected = await handle(new Request("https://home.test/api/access/logout", {
      method: "POST",
      headers: { origin: "https://attacker.test", host: "home.test" },
    }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has("set-cookie")).toBe(false);
  });
});
