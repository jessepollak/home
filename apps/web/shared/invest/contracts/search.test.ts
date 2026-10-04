import { expect, test } from "bun:test";
import { parseInvestSearchRequest, parseInvestSearchResponse } from "./search";

const page = {
  version: 1, query: "BTC", offset: 0, results: [{ kind: "configured", assetId: "cbbtc", match: "exact" }],
  snapshots: [], provider: "ok", coverage: "complete", nextOffset: null,
};

for (const provider of ["error", "unavailable"]) {
  test(`${provider} search is accepted only as partial`, () => {
    expect(parseInvestSearchResponse({ ...page, provider })).toBeNull();
    expect(parseInvestSearchResponse({ ...page, provider, coverage: "partial" })).toMatchObject({ provider, coverage: "partial" });
  });
}

test("rejects malformed search envelopes and entries", () => {
  for (const malformed of [
    null, [], {}, { ...page, version: 2 }, { ...page, results: undefined }, { ...page, snapshots: undefined },
    { ...page, results: [{ kind: "configured", assetId: "unknown", match: "exact" }] },
    { ...page, results: [{ kind: "configured", assetId: "cbbtc", match: "unknown" }] },
    { ...page, snapshots: [{ assetId: "unknown", displayPrice: "", asOf: "today", sourceLabel: "Codex" }] },
    { ...page, offset: -1 }, { ...page, offset: 0.5 }, { ...page, offset: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, nextOffset: undefined }, { ...page, nextOffset: 0 }, { ...page, nextOffset: 101 },
    { ...page, nextOffset: 1.5 }, { ...page, provider: {} }, { ...page, coverage: "unknown" },
  ]) expect(parseInvestSearchResponse(malformed)).toBeNull();
});

test("search deduplicates configured contracts and filters unrelated snapshots", () => {
  expect(parseInvestSearchResponse({ ...page, results: [...page.results, ...page.results], snapshots: [{ assetId: "cbbtc", displayPrice: "$1", asOf: "today", sourceLabel: "Codex" }] })).toMatchObject({
    results: [{ asset: { id: "cbbtc" }, source: "configured" }], snapshots: [],
  });
});

test("search accepts valid pagination without imposing request-only page restrictions", () => {
  expect(parseInvestSearchResponse({ ...page, offset: 1, nextOffset: 2 })).toMatchObject({ offset: 1, nextOffset: 2 });
});

test("search request keeps Unicode normalization and empty-offset defaults", () => {
  expect(parseInvestSearchRequest(new URLSearchParams({ q: "  ＢＴＣ  ", offset: "" }))).toEqual({ query: "BTC", offset: 0 });
  expect(parseInvestSearchRequest(new URLSearchParams({ q: "orbit", offset: "100" }))).toEqual({ query: "orbit", offset: 100 });
});

const invalidRequests: Record<string, string>[] = [{ q: "" }, { q: "a".repeat(65) }, { q: "BTC", offset: "01" }, { q: "BTC", offset: "20.0" }, { q: "BTC", offset: "21" }, { q: "BTC", offset: "120" }];
test("rejects malformed search requests", () => {
  for (const params of invalidRequests) {
    expect(parseInvestSearchRequest(new URLSearchParams(params))).toBeNull();
  }
});
