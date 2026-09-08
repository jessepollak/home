import { describe, expect, test } from "bun:test";
import { createErrorMarketHistoryResponse } from "@/server/market-data/codex/history";
import type { MarketPriceHistoryResponse } from "@/server/market-data/codex/history-contract";
import { createMarketPriceHistoryHandler } from "./handler";
import { dynamic, runtime } from "./route";

const ready: MarketPriceHistoryResponse = {
  version: 1,
  provider: "codex",
  assetId: "cbbtc",
  range: "1W",
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
    expect(calls).toBe(0);
  });

  test("does not leak upstream errors or credentials", async () => {
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
});
