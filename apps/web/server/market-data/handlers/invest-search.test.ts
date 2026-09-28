import "server-only";

import { describe, expect, test } from "bun:test";
import { INVEST_SETTINGS_DEFAULTS, type InvestSettings } from "@/shared/operator-settings/invest";
import { searchFixture, nonTrendingAddress } from "@/tests/browser/feature-map/search-fixtures";
import { parseInvestSearchResponse, type InvestSearchResponse } from "@/shared/invest/contracts/search";
import { createInvestVisibilityReader } from "@/server/operator-settings/invest";
import { createInvestSearchHandler } from "./invest-search";

const request = () => new Request("https://home.test/api/invest/search?q=ORB");
const dynamicId = `base:${nonTrendingAddress}`;
const fixture: InvestSearchResponse = {
  ...searchFixture("ORB"),
  results: [
    { kind: "configured", assetId: "nvdac", match: "exact" },
    { kind: "configured", assetId: "aaplc", match: "partial" },
    { kind: "configured", assetId: "cbbtc", match: "partial" },
    { kind: "configured", assetId: "degen", match: "partial" },
    ...searchFixture("ORB").results,
  ],
  nextOffset: 20,
};

async function search(settings: InvestSettings, data = fixture) {
  const GET = createInvestSearchHandler(async () => data, async () => ({ settings, available: true }));
  const response = await GET(request());
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json() as Promise<InvestSearchResponse>;
}

const resultIds = (response: InvestSearchResponse) => response.results.map((item) => item.kind === "configured" ? item.assetId : item.asset.id);

describe("GET /api/invest/search visibility", () => {
  test("defaults retain configured and dynamic results and their snapshots", async () => {
    const result = await search(INVEST_SETTINGS_DEFAULTS);
    expect(resultIds(result)).toContain("nvdac");
    expect(resultIds(result)).toContain(dynamicId);
    expect(result.snapshots.map((snapshot) => snapshot.assetId)).toContain(dynamicId);
    expect(result.nextOffset).toBe(20);
  });

  test("filters a hidden asset and an entire category after the cached reader", async () => {
    const result = await search({ hiddenCategories: ["stock"], hiddenAssets: ["cbbtc"] });
    expect(resultIds(result)).not.toContain("nvdac");
    expect(resultIds(result)).not.toContain("aaplc");
    expect(resultIds(result)).not.toContain("cbbtc");
    expect(resultIds(result)).toContain("degen");
    expect(resultIds(result)).toContain(dynamicId);
    const parsed = parseInvestSearchResponse(result);
    expect(parsed?.results.map(({ asset }) => asset.id)).toContain("degen");
    expect(parsed?.results.map(({ asset }) => asset.id)).not.toContain("cbbtc");
    expect(parsed?.snapshots.map(({ assetId }) => assetId)).toContain(dynamicId);
  });

  test("hidden memes drop dynamic results, associated snapshots and pagination", async () => {
    const result = await search({ hiddenCategories: ["meme"], hiddenAssets: [] });
    expect(resultIds(result)).toEqual(["nvdac", "aaplc", "cbbtc"]);
    expect(result.snapshots).toEqual([]);
    expect(result.nextOffset).toBeNull();
  });

  test("hidden memes skip later pages before the upstream reader", async () => {
    let calls = 0;
    const GET = createInvestSearchHandler(async () => { calls++; return fixture; }, async () => ({ settings: { hiddenCategories: ["meme"], hiddenAssets: [] }, available: true }));
    const response = await GET(new Request("https://home.test/api/invest/search?q=ORB&offset=20"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ version: 1, query: "ORB", offset: 20, results: [], snapshots: [], provider: "skipped", coverage: "complete", nextOffset: null });
    expect(calls).toBe(0);
  });

  test("unavailable visibility with no last-known-good fails closed and marks partial coverage", async () => {
    const reader = createInvestVisibilityReader({ read: async () => { throw new Error("unavailable"); } });
    let calls = 0;
    const GET = createInvestSearchHandler(async () => { calls++; return fixture; }, reader.readVisibility);
    const response = await GET(request());
    const result = await response.json() as InvestSearchResponse;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result.results).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.nextOffset).toBeNull();
    expect(result.provider).toBe("unavailable");
    expect(result.coverage).toBe("partial");
    expect(calls).toBe(0);
  });

  test("rejects a malformed request before reading search or visibility", async () => {
    const GET = createInvestSearchHandler(async () => { throw new Error("unexpected search"); }, async () => { throw new Error("unexpected visibility"); });
    const response = await GET(new Request("https://home.test/api/invest/search?q="));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a hidden first page of configured matches does not hide later visible matches", async () => {
    const hiddenStocks = ["nvdac", "metac", "aaplc", "googlc", "amznc", "msftc", "mstrc", "sndkc"];
    const data: InvestSearchResponse = {
      ...searchFixture("0xb200"),
      results: [
        ...hiddenStocks.map((assetId) => ({ kind: "configured" as const, assetId, match: "prefix" as const })),
        { kind: "configured", assetId: "cbhype", match: "prefix" },
        { kind: "configured", assetId: "cbzec", match: "prefix" },
      ],
    };
    const result = await search({ hiddenCategories: ["stock"], hiddenAssets: [] }, data);
    expect(resultIds(result)).toEqual(["cbhype", "cbzec"]);
  });

  test("caps visible configured matches and keeps every dynamic result", async () => {
    const configuredIds = ["nvdac", "metac", "aaplc", "googlc", "amznc", "msftc", "mstrc", "sndkc", "spcxc", "tslac"];
    const data: InvestSearchResponse = {
      ...searchFixture("0xb200"),
      results: [
        ...configuredIds.map((assetId) => ({ kind: "configured" as const, assetId, match: "prefix" as const })),
        ...searchFixture("ORB").results,
      ],
    };
    const result = await search(INVEST_SETTINGS_DEFAULTS, data);
    expect(resultIds(result).filter((id) => configuredIds.includes(id))).toHaveLength(8);
    expect(resultIds(result)).toContain(dynamicId);
  });

  test("drops a configured result whose id is no longer in the catalog", async () => {
    const data: InvestSearchResponse = {
      ...searchFixture("ORB"),
      results: [
        { kind: "configured", assetId: "not-in-the-catalog", match: "exact" },
        { kind: "configured", assetId: "cbbtc", match: "exact" },
      ],
    };
    const result = await search(INVEST_SETTINGS_DEFAULTS, data);
    expect(resultIds(result)).toEqual(["cbbtc"]);
  });

  test("re-filters the same reader result after a settings change", async () => {
    let settings: InvestSettings = { hiddenCategories: ["stock"], hiddenAssets: [] };
    const GET = createInvestSearchHandler(async () => fixture, async () => ({ settings, available: true }));
    const first = await (await GET(request())).json() as InvestSearchResponse;
    expect(resultIds(first)).not.toContain("nvdac");
    settings = { hiddenCategories: [], hiddenAssets: [] };
    const second = await (await GET(request())).json() as InvestSearchResponse;
    expect(resultIds(second)).toContain("nvdac");
  });
});
