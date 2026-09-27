import { describe, expect, test } from "bun:test";
import { dynamic, GET, runtime } from "./route";

describe("GET /api/market-prices/stats route", () => {
  test("is public, dynamic, Node-only and rejects invalid asset ids", async () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    const response = await GET(new Request("https://home.test/api/market-prices/stats?assetId=invalid"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ assetId: null, status: "unavailable", unavailableReason: "unknown-asset", stats: {} });
  });

  test("never requests provider stats for a configured stock", async () => {
    const response = await GET(new Request("https://home.test/api/market-prices/stats?assetId=nvdac"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assetId: "nvdac", status: "unavailable", unavailableReason: "unsupported-asset", stats: {} });
  });
});
