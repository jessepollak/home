import { describe, expect, test } from "bun:test";
import { ACCOUNT_PROVIDER_HEADER } from "@/shared/account/session-types";
import { privateError, privateJson, withPrivateHeaders } from "./private-response";

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("vary")).toBe(`Authorization, ${ACCOUNT_PROVIDER_HEADER}`);
}

describe("private JSON responses", () => {
  test("defaults to 200 and preserves the JSON body", async () => {
    const body = { result: { value: "saved" } };
    const response = privateJson(body);
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(await response.json()).toEqual(body);
  });

  test("accepts an explicit status", async () => {
    const body = { value: 42 };
    const response = privateJson(body, 201);
    expect(response.status).toBe(201);
    expectPrivateHeaders(response);
    expect(await response.json()).toEqual(body);
  });

  test("preserves the private error shape", async () => {
    const response = privateError("NOT_FOUND", "Missing resource.", 404);
    expect(response.status).toBe(404);
    expectPrivateHeaders(response);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Missing resource." } });
  });

  test("overrides private headers without changing the status, body, or unrelated headers", async () => {
    const original = Response.json({ value: "unchanged" }, {
      status: 401,
      headers: {
        "Cache-Control": "public, max-age=60",
        Pragma: "cache",
        "Referrer-Policy": "unsafe-url",
        Vary: "Accept-Encoding",
        "X-Custom": "retained",
        "Set-Cookie": "session=empty; HttpOnly",
      },
    });
    const response = withPrivateHeaders(original);
    expect(response.status).toBe(401);
    expectPrivateHeaders(response);
    expect(response.headers.get("x-custom")).toBe("retained");
    expect(response.headers.getSetCookie()).toEqual(["session=empty; HttpOnly"]);
    expect(await response.json()).toEqual({ value: "unchanged" });
  });
});
