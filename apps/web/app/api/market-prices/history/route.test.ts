import { describe, expect, test } from "bun:test";
import {
  createCodexMarketHistoryReader,
  createErrorMarketHistoryResponse,
} from "@/server/market-data/codex/history";
import type { MarketPriceHistoryResponse } from "@/server/market-data/codex/history-contract";
import { createMarketPriceHistoryHandler } from "./handler";
import { dynamic, runtime } from "./route";

const ready: MarketPriceHistoryResponse = {
  version: 1,
  provider: "codex",
  assetId: "cbbtc",
  range: "1W",
  currency: "USD",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  status: "ready",
  points: [{ time: "2026-09-07T00:00:00.000Z", value: "64210.5" }],
};

describe("GET /api/market-prices/history", () => {
  test("is a public Node route and returns allowlisted history without authentication", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");

    const GET = createMarketPriceHistoryHandler(async () => ready);
    const response = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=cbbtc&range=1W"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=30",
    );
    expect(await response.json()).toEqual(ready);
  });

  test("serves a canonical dynamic Base asset through the bounded Codex reader contract", async () => {
    const dynamicId = "base:0x1111111111111111111111111111111111111111";
    let requestedSymbol = "";
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          variables: { symbol: string; from: number; to: number; resolution: string };
        };
        requestedSymbol = body.variables.symbol;
        expect(body.variables.to - body.variables.from).toBe(24 * 60 * 60);
        expect(body.variables.resolution).toBe("15");
        return new Response(
          '{"data":{"getBars":{"t":[1788955200],"c":[0.0123],"s":"ok"}}}',
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const GET = createMarketPriceHistoryHandler(reader);
    const response = await GET(
      new Request(
        `http://home.test/api/market-prices/history?assetId=${encodeURIComponent(dynamicId)}&range=1D`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=30, stale-while-revalidate=30",
    );
    expect(requestedSymbol).toBe(
      "0x1111111111111111111111111111111111111111:8453",
    );
    expect(await response.json()).toMatchObject({
      assetId: dynamicId,
      range: "1D",
      currency: "USD",
      status: "ready",
      points: [{ value: "0.0123" }],
    });
  });

  test("rejects unknown assets and ranges before touching Codex", async () => {
    let calls = 0;
    const GET = createMarketPriceHistoryHandler(async () => {
      calls += 1;
      return ready;
    });

    const unknown = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=evil&range=1W"),
    );
    const invalidRange = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=cbbtc&range=2Y"),
    );
    const nonCanonicalDynamic = await GET(
      new Request(
        "http://home.test/api/market-prices/history?assetId=base%3A0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&range=1W",
      ),
    );

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      status: "unavailable",
      unavailableReason: "unknown-asset",
      points: [],
    });
    expect(invalidRange.status).toBe(400);
    expect(await invalidRange.json()).toMatchObject({
      unavailableReason: "invalid-range",
      points: [],
    });
    expect(nonCanonicalDynamic.status).toBe(400);
    expect(await nonCanonicalDynamic.json()).toMatchObject({
      unavailableReason: "unknown-asset",
      points: [],
    });
    expect(calls).toBe(0);
  });

  test("rejects mismatched reader identity instead of caching the wrong asset", async () => {
    const GET = createMarketPriceHistoryHandler(async () => ({
      ...ready,
      assetId: "cbltc",
    }));
    const response = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=cbbtc&range=1W"),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(createErrorMarketHistoryResponse("cbbtc", "1W"));
  });

  test("does not leak unexpected upstream errors or credentials", async () => {
    const GET = createMarketPriceHistoryHandler(async () => {
      throw new Error("upstream body and fixture-secret");
    });
    const response = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=cbbtc&range=1W"),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe(JSON.stringify(createErrorMarketHistoryResponse("cbbtc", "1W")));
    expect(body).not.toContain("upstream body");
    expect(body).not.toContain("fixture-secret");
  });

  test("returns a sanitized no-store 502 for malformed upstream history", async () => {
    const reader = createCodexMarketHistoryReader({
      apiKey: "fixture-secret",
      fetchImpl: async () =>
        Response.json({
          data: {
            getBars: { s: "ok", t: [1757332800], c: [] },
          },
        }),
    });
    const GET = createMarketPriceHistoryHandler(reader);
    const response = await GET(
      new Request("http://home.test/api/market-prices/history?assetId=cbbtc&range=1W"),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe(JSON.stringify(createErrorMarketHistoryResponse("cbbtc", "1W")));
    expect(body).not.toContain("malformed");
    expect(body).not.toContain("fixture-secret");
  });
});
