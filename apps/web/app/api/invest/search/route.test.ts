import { describe, expect, test } from "bun:test";
import { createInvestSearchHandler } from "@/server/market-data/handlers/invest-search";
import { createCodexSearchReader } from "@/server/market-data/codex/search";

const url = (query: string) => new Request(`https://home.test/api/invest/search${query}`);

describe("GET /api/invest/search", () => {
  test("rejects empty, long and out-of-bounds requests before any upstream call", async () => {
    let calls = 0;
    const handler = createInvestSearchHandler(async () => { calls++; throw new Error("unreachable"); });
    for (const suffix of ["", "?q=%20", `?q=${"a".repeat(65)}`, "?q=BTC&offset=21", "?q=BTC&offset=120", "?q=BTC&offset=-1", "?q=BTC&offset=Infinity"]) {
      const result = await handler(url(suffix));
      expect(result.status).toBe(400);
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
    expect(calls).toBe(0);
  });

  test("returns no-store successful and partial pages without leaking upstream responses", async () => {
    const success = createInvestSearchHandler(createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => Response.json({ data: { filterTokens: { results: [], count: 0, page: 0 } } }) }));
    const ok = await success(url("?q=BTC"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toMatchObject({ version: 1, provider: "ok", coverage: "complete", results: [{ assetId: "cbbtc" }] });
    const failure = createInvestSearchHandler(createCodexSearchReader({ apiKey: "fixture", fetchImpl: async () => new Response("private upstream body", { status: 429 }) }));
    const error = await failure(url("?q=BTC"));
    expect(error.status).toBe(200);
    expect(error.headers.get("cache-control")).toBe("no-store");
    const text = await error.text();
    expect(text).toContain('"coverage":"partial"');
    expect(text).not.toContain("private upstream body");
  });
});
