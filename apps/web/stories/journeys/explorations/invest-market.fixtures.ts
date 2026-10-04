import { http, HttpResponse } from "msw";
import { assetResolutionFixture } from "@/tests/browser/feature-map/search-fixtures";
import { assetDetailAsset, assetDetailTime } from "./invest-asset-detail-fixture";

export const investMarketHandlers = [
  http.get("/api/market-prices/history", ({ request }) => {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");
    const range = url.searchParams.get("range") ?? "1W";
    if (assetId !== assetDetailAsset.id) {
      if (!assetId || !assetResolutionFixture(assetId).asset) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json({ version: 1, provider: "codex", assetId, range, currency: "USD", fetchedAt: null, status: "empty", points: [] });
    }
    const durations: Record<string, number> = { "1D": 86400000, "1W": 604800000, "1M": 2592000000, "3M": 7776000000, "1Y": 31536000000 };
    const duration = durations[range] ?? 604800000;
    const end = Date.parse(assetDetailTime) - 60000;
    return HttpResponse.json({ version: 1, provider: "codex", assetId, range,
      currency: "USD", fetchedAt: new Date(end).toISOString(), status: "ready",
      points: Array.from({ length: 32 }, (_, index) => ({
        time: new Date(end - duration * (1 - index / 31)).toISOString(),
        value: (117000 + 5391.18 * index / 31).toFixed(2),
      })) });
  }),
  http.get("/api/market-prices/stats", ({ request }) => {
    const assetId = new URL(request.url).searchParams.get("assetId");
    if (assetId !== assetDetailAsset.id) {
      if (!assetId || !assetResolutionFixture(assetId).asset) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json({ version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: null, status: "unavailable", stats: {} });
    }
    return HttpResponse.json({ version: 1, provider: "codex", assetId, currency: "USD", fetchedAt: assetDetailTime, status: "ready",
      stats: { marketCapUsd: { atoms: "2410000000000", scale: 0 }, volume24hUsd: { atoms: "38200000000", scale: 0 } },
    });
  }),
];
