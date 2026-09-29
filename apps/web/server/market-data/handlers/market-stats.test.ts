import "server-only";

import { describe, expect, test } from "bun:test";
import { createMarketStatsHandler } from "./market-stats";
import { createErrorMarketStatsResponse } from "../codex/market-stats";
import type { MarketStatsResponse } from "@/shared/invest/contracts/market-stats";

const dynamicId = "base:0x1111111111111111111111111111111111111111";
const ready: MarketStatsResponse = {
  version: 1,
  provider: "codex",
  assetId: "cbbtc",
  currency: "USD",
  fetchedAt: "2026-09-13T12:00:00.000Z",
  status: "ready",
  stats: { marketCapUsd: { atoms: "125", scale: 1 } },
};

const request = (assetId: string) => new Request(`https://home.test/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`);

describe("GET /api/market-prices/stats", () => {
  test("serves static public stats without dynamic admission", async () => {
    const GET = createMarketStatsHandler(async () => ready, async () => { throw new Error("must not admit static assets"); });
    const response = await GET(request("cbbtc"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=30");
    expect(await response.json()).toEqual(ready);
  });

  test("admits a canonical dynamic asset using its Base contract", async () => {
    const seen: Array<[string, number]> = [];
    const GET = createMarketStatsHandler(
      async (id) => ({ ...ready, assetId: id as `base:0x${string}` }),
      async (address, networkId) => {
        seen.push([address, networkId]);
        return true;
      },
    );
    const response = await GET(request(dynamicId));
    expect(response.status).toBe(200);
    expect(seen).toEqual([["0x1111111111111111111111111111111111111111", 8453]]);
    expect(await response.json()).toMatchObject({ assetId: dynamicId, status: "ready" });
  });

  test("rejects unadmitted or failed admission without touching Codex", async () => {
    let calls = 0;
    for (const admission of [async () => false, async (): Promise<boolean> => { throw new Error("not available"); }]) {
      const GET = createMarketStatsHandler(async () => { calls += 1; return ready; }, admission);
      const response = await GET(request(dynamicId));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ assetId: dynamicId, status: "unavailable", unavailableReason: "unknown-asset", stats: {} });
    }
    expect(calls).toBe(0);
  });

  test("rejects unknown and noncanonical asset IDs before reading", async () => {
    let calls = 0;
    const GET = createMarketStatsHandler(async () => { calls += 1; return ready; });
    for (const id of ["evil", "base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "base:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"]) {
      const response = await GET(request(id));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ assetId: null, unavailableReason: "unknown-asset" });
    }
    expect(calls).toBe(0);
  });

  test("serves unsupported and unconfigured responses with bounded caching", async () => {
    const GET = createMarketStatsHandler(async (id) => ({
      ...ready,
      assetId: id as "cbbtc",
      fetchedAt: null,
      status: "unavailable",
      stats: {},
      unavailableReason: "not-configured",
    }));
    const response = await GET(request("cbbtc"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(await response.json()).toMatchObject({ status: "unavailable", unavailableReason: "not-configured" });
  });

  test("sanitizes reader errors and mismatched identities as no-store 502", async () => {
    for (const read of [
      async () => createErrorMarketStatsResponse("cbbtc"),
      async () => ({ ...ready, assetId: "cbltc" as const }),
      async (): Promise<MarketStatsResponse> => { throw new Error("fixture-secret upstream error"); },
    ]) {
      const response = await createMarketStatsHandler(read)(request("cbbtc"));
      expect(response.status).toBe(502);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toBe(JSON.stringify(createErrorMarketStatsResponse("cbbtc")));
      expect(body).not.toContain("fixture-secret");
    }
  });
});
