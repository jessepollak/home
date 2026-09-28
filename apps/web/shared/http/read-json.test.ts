import { describe, expect, test } from "bun:test";
import { readJson } from "./read-json";

describe("readJson", () => {
  test("reads a JSON object", async () => {
    expect(await readJson(Response.json({ version: 1, ok: true }))).toEqual({ version: 1, ok: true });
  });

  test("rejects malformed JSON", async () => {
    await expect(readJson(new Response("not-json"))).rejects.toBeInstanceOf(SyntaxError);
  });

  test("reads JSON null", async () => {
    expect(await readJson(new Response("null"))).toBeNull();
  });
});
