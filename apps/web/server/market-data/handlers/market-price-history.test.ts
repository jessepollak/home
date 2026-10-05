import { expect, test } from "bun:test";
import { createMarketPriceHistoryHandler } from "./market-price-history";
import { expectedMarketPriceHistorySource, parseHistoryResponse, type MarketPriceHistoryResponse } from "@/shared/invest/contracts/market-price-history";

function payload(assetId: string, status: MarketPriceHistoryResponse["status"] = "ready"): MarketPriceHistoryResponse {
  const source = expectedMarketPriceHistorySource(assetId);
  const stock = source?.kind === "tokenized-equity-feed";
  const points = status === "ready" ? [{ time: "2026-10-05T16:00:00.000Z", value: "123.45", ...(stock ? { session: "open" as const } : {}) }] : [];
  return { version: 2, provider: stock ? "chainlink" : "codex", source, assetId, range: "1W", currency: "USD", status, points,
    fetchedAt: "2026-10-05T16:00:00.000Z", ...(stock ? { coverage: { sampled: 32, observed: points.length,
      gaps: [{ from: "2026-09-28T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z", reason: "incomplete" as const }] } } : {}) };
}
const request = (assetId = "nvdac", range = "1W", speculative = false) => new Request(`https://home.test/api/market-prices/history?assetId=${assetId}&range=${range}`, { headers: speculative ? { "x-home-history-priority": "prefetch" } : {} });

test("stock history never calls Codex and partial ready results remain cacheable", async () => {
  let options: unknown;
  const handler = createMarketPriceHistoryHandler(async () => { throw new Error("Codex must not read stocks"); }, async () => { throw new Error("No admission required"); }, async (assetId, _range, priority) => {
    options = priority; const result = payload(assetId);
    if (!result.coverage) throw new Error("Missing stock history coverage");
    result.coverage.gaps = [{ from: "2026-09-28T16:00:00.000Z", to: "2026-10-05T16:00:00.000Z", reason: "incomplete" }]; return result;
  });
  const result = await handler(request("nvdac", "1W", true));
  expect(result.status).toBe(200); expect(result.headers.get("Cache-Control")).toContain("max-age=30");
  expect(parseHistoryResponse(await result.json())?.provider).toBe("chainlink"); expect(options).toEqual({ speculative: true });
});

test.each(["error", "overloaded", "throw"] as const)("stock %s failures are no-store without a Codex fallback", async (state) => {
  const handler = createMarketPriceHistoryHandler(async () => { throw new Error("Codex forbidden"); }, undefined, async (assetId) => {
    if (state === "throw") throw new Error("RPC failed");
    return { ...payload(assetId, state === "overloaded" ? "unavailable" : "error"), ...(state === "overloaded" ? { unavailableReason: "overloaded" as const } : {}) };
  });
  const result = await handler(request()); expect(result.status).toBe(state === "overloaded" ? 503 : 502);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(parseHistoryResponse(await result.json())?.source?.kind).toBe("tokenized-equity-feed");
});

test("non-stock history uses the exact contract Codex source", async () => {
  const handler = createMarketPriceHistoryHandler(async (assetId) => payload(assetId), undefined, async () => { throw new Error("Stock reader forbidden"); });
  const result = await handler(request("cbbtc")); expect(result.status).toBe(200);
  expect(parseHistoryResponse(await result.json())?.source).toEqual({ kind: "codex", chainId: 8453, contractAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" });
});

test("dynamic tokens keep server admission and range validation", async () => {
  const assetId = "base:0x1111111111111111111111111111111111111111"; let reads = 0;
  const denied = createMarketPriceHistoryHandler(async (id) => { reads += 1; return payload(id); }, async () => false);
  expect((await denied(request(assetId))).status).toBe(404); expect((await denied(request("nvdac", "2Y"))).status).toBe(400); expect(reads).toBe(0);
  const admitted = createMarketPriceHistoryHandler(async (id) => payload(id), async (address, chainId) => address === assetId.slice(5) && chainId === 8453);
  const response = await admitted(request(assetId)); expect(response.status).toBe(200); expect(parseHistoryResponse(await response.json())?.source?.kind).toBe("codex");
});

test.each(["assetId", "range", "source"] as const)("mismatched %s is rejected instead of cached", async (field) => {
  const handler = createMarketPriceHistoryHandler(undefined, undefined, async (assetId) => ({ ...payload(assetId), [field]: field === "source" ? expectedMarketPriceHistorySource("aaplc") : "cbbtc" }));
  const result = await handler(request()); expect(result.status).toBe(502); expect(result.headers.get("Cache-Control")).toBe("no-store");
});
