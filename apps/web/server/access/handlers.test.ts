import { describe, expect, test } from "bun:test";
import { accessErrorCode, accessSuccessDestination } from "@/shared/access/contract";
import { createAccessLoginHandler, createAccessLogoutHandler } from "./handlers";

const CREDENTIAL = "a".repeat(8);
const SIGNING_SECRET = "b".repeat(32);
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
    getConfig: () => ({ kind: "enabled", credential: CREDENTIAL, signingSecret: SIGNING_SECRET}),
    now: () => new Date("2026-09-18T12:00:00.000Z"),
  });

  test("sets only the access cookie and redirects to a safe destination", async () => {
    const response = await handle(request(body(CREDENTIAL, "/borrow?asset=usdc")));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://home.test/borrow?asset=usdc");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("home-access=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("home-session");
  });

  test("returns a bounded JSON success without following the protected destination", async () => {
    const response = await handle(request(
      body(CREDENTIAL, "/save?asset=usdc"),
      { "x-home-access-response": "json" },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("home-access=");
    expect(response.headers.get("vary")).toBe("Cookie, X-Home-Access-Response");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({
      version: 1,
      destination: "/save?asset=usdc",
    });
  });

  test("JSON login responses round-trip through the client contract", async () => {
    const success = await handle(request(body(CREDENTIAL, "/save?asset=usdc"), {
      "x-home-access-response": "json",
    }));
    expect(success.status).toBe(200);
    expect(accessSuccessDestination(await success.json())).toBe("/save?asset=usdc");

    const invalid = await handle(request(body("wrong")));
    expect(invalid.status).toBe(401);
    expect(accessErrorCode(await invalid.json())).toBe("INVALID_ACCESS");

    const unavailable = createAccessLoginHandler({ getConfig: () => ({ kind: "misconfigured" }) });
    const outage = await unavailable(request(body(CREDENTIAL)));
    expect(outage.status).toBe(503);
    expect(accessErrorCode(await outage.json())).toBe("ACCESS_UNAVAILABLE");
  });

  test("rejects an extra form field without setting a cookie", async () => {
    const form = new URLSearchParams(body(CREDENTIAL));
    form.append("unexpected", "value");
    const response = await handle(request(form.toString()));
    expect(response.status).toBe(401);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toEqual({ version: 1, error: { code: "INVALID_ACCESS" } });
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
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("vary")).toBe("Cookie, X-Home-Access-Response");
      expect(await response.json()).toEqual({ version: 1, error: { code: "INVALID_ACCESS" } });
    }
  });

  test("bounds streamed forms and preserves invalid-access failure contracts", async () => {
    const controller = new AbortController();
    const headers = request("").headers;
    const failed = new Request("https://home.test/api/access", {
      method: "POST", headers,
      body: new ReadableStream<Uint8Array>({ start(stream) { stream.error(new Error("read failed")); } }),
    });
    let cancelled = false;
    const aborted = new Request("https://home.test/api/access", {
      method: "POST", headers, signal: controller.signal,
      body: new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }),
    });
    const pending = handle(aborted);
    controller.abort();
    const cases = [
      await pending,
      await handle(failed),
      await handle(request(body(CREDENTIAL).padEnd(4097, "&"))),
      await handle(request(body(CREDENTIAL), { "content-type": "application/json" })),
      await handle(request(body(CREDENTIAL), { "content-length": "invalid" })),
    ];
    for (const response of cases) {
      expect(response.status).toBe(400);
      expect(accessErrorCode(await response.json())).toBe("INVALID_ACCESS");
      expect(response.headers.has("set-cookie")).toBe(false);
    }
    expect(cancelled).toBe(true);
    expect(aborted.body?.locked).toBe(false);
  });

  test("retains form length boundary, Number-coercible lengths and replacement UTF-8", async () => {
    expect((await handle(request(body(CREDENTIAL).padEnd(4096, "&")))).status).toBe(303);
    for (const length of ["1e2", "1.5", "0x10", ""]) {
      expect((await handle(request(body(CREDENTIAL), { "content-length": length }))).status).toBe(303);
    }
    const prefix = new TextEncoder().encode(body(CREDENTIAL, "/"));
    const response = await handle(new Request("https://home.test/api/access", {
      method: "POST", headers: request("").headers, body: new Uint8Array([...prefix, 0xff]),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://home.test/%EF%BF%BD");
  });

  test("fails closed without exposing configuration detail", async () => {
    const unavailable = createAccessLoginHandler({ getConfig: () => ({ kind: "misconfigured" }) });
    const response = await unavailable(request(body(CREDENTIAL)));
    expect(response.status).toBe(503);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
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
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("home-access=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("home-session");

    const rejected = await handle(new Request("https://home.test/api/access/logout", {
      method: "POST",
      headers: { origin: "https://attacker.test", host: "home.test" },
    }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("referrer-policy")).toBe("no-referrer");
    expect(rejected.headers.has("set-cookie")).toBe(false);
  });
});
