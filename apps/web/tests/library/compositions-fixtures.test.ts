import { expect, test } from "bun:test";
import type { HttpHandler } from "msw";
import { homeShellHandlers } from "@/stories/journeys/explorations/home-pull-to-refresh.fixtures";
import { sendRecipientHandlers } from "@/stories/journeys/explorations/send-recipient.fixtures";
import { investMarketHandlers } from "@/stories/journeys/explorations/invest-market.fixtures";
import { assetDetailAsset } from "@/stories/journeys/explorations/invest-asset-detail-fixture";
import { searchFixture } from "@/tests/browser/feature-map/search-fixtures";
import { assertFundingProvidersResponse } from "@/shared/funding/contracts/providers";
import { readFundingOpenOrderResponse } from "@/shared/funding/contracts/open-order";
import { parseHistoryResponse } from "@/shared/invest/contracts/market-price-history";
import { parseMarketStatsResponse } from "@/shared/invest/contracts/market-stats";

async function fixtureResponse(handlers: HttpHandler[], path: string, method = "GET") {
  const request = new Request(`http://home.test${path}`, { method });
  const input = { request, requestId: "fixture-test", resolutionContext: { baseUrl: "http://home.test" } };
  for (const handler of handlers) {
    if (!await handler.test(input)) continue;
    const result = await handler.run(input);
    if (result?.response) return result.response;
  }
  throw new Error(`Unhandled fixture request: ${method} ${path}`);
}

test("Home resources handle both funding directions, open orders and performance reports", async () => {
  const handlers = [...homeShellHandlers, ...sendRecipientHandlers];
  for (const direction of ["onramp", "offramp"] satisfies ("onramp" | "offramp")[]) {
    const response = await fixtureResponse(handlers, `/api/funding/providers?region=US&direction=${direction}`);
    const body: unknown = await response.json();
    expect(() => assertFundingProvidersResponse(body, direction, "US")).not.toThrow();
  }
  expect(readFundingOpenOrderResponse(await (await fixtureResponse(handlers, "/api/funding/orders?region=US")).json()))
    .toEqual({ version: 1, order: null });
  expect(await (await fixtureResponse(handlers, "/api/client-performance?kind=home-startup", "POST")).json()).toEqual({ ok: true });
});

test("Invest fixtures retain the requested search or detail asset identity", async () => {
  const assetIds = [assetDetailAsset.id, ...searchFixture("ORB").results.flatMap((result) => result.kind === "dynamic" ? [result.asset.id] : [])];
  expect(assetIds.length).toBe(4);
  for (const assetId of assetIds) {
    const history = parseHistoryResponse(await (await fixtureResponse(investMarketHandlers, `/api/market-prices/history?assetId=${encodeURIComponent(assetId)}&range=1W`)).json());
    const stats = parseMarketStatsResponse(await (await fixtureResponse(investMarketHandlers, `/api/market-prices/stats?assetId=${encodeURIComponent(assetId)}`)).json());
    expect(history?.assetId === assetId).toBe(true);
    expect(stats?.assetId === assetId).toBe(true);
    expect(history?.status).toBe(assetId === assetDetailAsset.id ? "ready" : "empty");
    expect(stats?.status).toBe(assetId === assetDetailAsset.id ? "ready" : "unavailable");
  }
  for (const resource of ["history", "stats"]) {
    expect((await fixtureResponse(investMarketHandlers, `/api/market-prices/${resource}?assetId=unknown`)).status).toBe(404);
  }
});
