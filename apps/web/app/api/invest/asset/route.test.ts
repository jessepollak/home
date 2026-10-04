import { expect, test } from "bun:test";
import { createResolveAssetHandler } from "@/server/market-data/handlers/resolve-asset";
import { createAssetResolver } from "@/server/market-data/resolve-asset";
import { parseAssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";

const address = "0x1111111111111111111111111111111111111111";
const assetId = `base:${address}`;
const request = (id = assetId) => new Request(`https://home.test/api/invest/asset?assetId=${id}`);
const row = { priceUSD: "1.25", change24: "0.02", lastTransaction: "1788955200", token: {
  address, name: "Orbit", symbol: "ORB", decimals: "18", networkId: "8453", info: {},
} };

for (const source of ["configured", "indexed", "onchain", "unavailable", "error"]) {
  test(`asset handler round-trips ${source} resolver output`, async () => {
    const resolve = createAssetResolver({
      apiKey: source === "unavailable" ? undefined : "fixture",
      isPair: async () => false,
      now: () => new Date("2026-09-08T20:00:00.000Z"),
      onchain: async () => ({ symbol: "ORB", decimals: 18 }),
      fetchImpl: async () => source === "error" ? new Response("private upstream error", { status: 503 }) :
        Response.json({ data: { filterTokens: { results: source === "onchain" ? [] : [row] } } }),
    });
    const response = await createResolveAssetHandler(resolve)(request(source === "configured" ? "cbbtc" : assetId));
    expect(response.status).toBe(200);
    const body = await response.json();
    const parsed = parseAssetResolutionResponse(body);
    if (source === "error" || source === "unavailable") {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(parsed).toEqual({ version: 1, assetId, asset: null, source: null, snapshot: null, provider: source });
    } else {
      expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=30");
      expect(parsed).toMatchObject({ assetId: source === "configured" ? "cbbtc" : assetId, source, provider: source === "configured" ? "skipped" : "ok" });
      if (source === "indexed") expect(parsed?.snapshot).toMatchObject({ assetId, displayPrice: "$1.25" });
      else expect(parsed?.snapshot).toBeNull();
    }
  });
}

test("asset handler exceptions round-trip as non-cacheable missing metadata", async () => {
  const response = await createResolveAssetHandler(async () => { throw new Error("private upstream body"); })(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(parseAssetResolutionResponse(await response.json())).toEqual({ version: 1, assetId, asset: null, source: null, snapshot: null, provider: "error" });
});

test("asset handler rejects invalid requests without invoking its reader", async () => {
  let called = false;
  const response = await createResolveAssetHandler(async () => { called = true; throw new Error("unreachable"); })(request("BTC"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid-asset" });
  expect(called).toBe(false);
});
