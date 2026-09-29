import "server-only";

import { describe, expect, test } from "bun:test";
import { createCodexMarketHistoryReader } from "@/server/market-data/codex/history";
import { createMarketPriceHistoryHandler } from "./market-price-history";

describe("market price history priority", () => {
  test("reserves a provider slot for active history when a prefetch is in flight", async () => {
    const releases: Array<(response: Response) => void> = [];
    let calls = 0;
    let resolveSecondDispatch!: () => void;
    const secondDispatch = new Promise<void>((resolve) => { resolveSecondDispatch = resolve; });
    const handler = createMarketPriceHistoryHandler(createCodexMarketHistoryReader({
      apiKey: "fixture-key",
      maxInFlight: 2,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 2) resolveSecondDispatch();
        return new Promise<Response>((resolve) => releases.push(resolve));
      },
    }));
    const url = (range: string) => `http://home.test/api/market-prices/history?assetId=cbbtc&range=${range}`;
    const prefetch = handler(new Request(url("1D"), { headers: { "x-home-history-priority": "prefetch" } }));
    const refused = await handler(new Request(url("1W"), { headers: { "x-home-history-priority": "prefetch" } }));
    expect(refused.status).toBe(503);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(calls).toBe(1);
    const active = handler(new Request(url("1W")));
    await secondDispatch;
    expect(calls).toBe(2);
    for (const release of releases) release(Response.json({ data: { getBars: { t: [], c: [], s: "no_data" } } }));
    expect((await prefetch).status).toBe(200);
    expect((await active).status).toBe(200);
  });
});
