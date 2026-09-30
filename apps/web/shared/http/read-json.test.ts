import { describe, expect, test } from "bun:test";
import { readJson } from "./read-json";

describe("readJson", () => {
  test("reads a Request body", async () => {
    const request = new Request("https://home.test/api/example", {
      method: "POST",
      body: JSON.stringify({ version: 1, value: "request" }),
    });

    const value: unknown = await readJson(request);

    expect(value).toEqual({ version: 1, value: "request" });
    expect(request.bodyUsed).toBe(true);
  });

  test("reads a Response body", async () => {
    const response = Response.json({ version: 1, value: "response" });

    const value: unknown = await readJson(response);

    expect(value).toEqual({ version: 1, value: "response" });
    expect(response.bodyUsed).toBe(true);
  });

  test.each([
    ["Request", () => new Request("https://home.test/api/example", { method: "POST", body: "invalid-json" })],
    ["Response", () => new Response("invalid-json")],
  ])("rejects malformed %s JSON", async (_kind, createBody) => {
    await expect(readJson(createBody())).rejects.toBeInstanceOf(SyntaxError);
  });
});
