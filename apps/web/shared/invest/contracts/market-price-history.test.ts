import { describe, expect, test } from "bun:test";
import { expectedMarketPriceHistorySource, parseHistoryResponse, resolveMarketPriceAssetIdentity } from "./market-price-history";

const point = { time: "2026-09-07T00:00:00.000Z", value: "64210.5" };
import type { MarketPriceHistoryResponse } from "./market-price-history";

const response: MarketPriceHistoryResponse = {
  version: 2, provider: "codex", source: expectedMarketPriceHistorySource("cbbtc"), assetId: "cbbtc", range: "1W", currency: "USD",
  fetchedAt: "2026-09-07T20:30:00.000Z", status: "ready", points: [point],
};

describe("market history contract", () => {
  test("rejects malformed envelopes or points instead of completing a partial history", () => {
    for (const value of [
      null,
      [],
      { ...response, version: 1 },
      { ...response, provider: "other" },
      { ...response, assetId: null },
      { ...response, assetId: undefined },
      { ...response, range: null },
      { ...response, range: "2Y" },
      { ...response, currency: "EUR" },
      { ...response, status: "partial" },
      { ...response, points: undefined },
      { ...response, points: {} },
      { ...response, unavailableReason: "overloaded" },
      { ...response, status: "unavailable", unavailableReason: "unknown" },
      ...[
        {},
        { ...point, time: "invalid" },
        { ...point, value: 1 },
        { ...point, value: "0" },
        { ...point, value: "0e10" },
        { ...point, value: "01" },
        { ...point, value: "-1" },
        { ...point, value: "1." },
      ].map((invalid) => ({ ...response, points: [point, invalid] })),
    ]) expect(parseHistoryResponse(value)).toBeNull();
  });

  test("preserves empty histories without inventing prices", () => {
    for (const status of ["ready", "empty", "unavailable", "error"] as const) {
      const empty = { ...response, status, points: [] };
      expect(parseHistoryResponse(empty)).toEqual(empty);
    }
  });

  test("preserves legacy string identities and optional field normalization", () => {
    expect(parseHistoryResponse({
      ...response, source: null, assetId: "unconfigured-string", currency: undefined, fetchedAt: 1,
      status: "unavailable", unavailableReason: "not-configured", extra: true, points: [{ ...point, extra: true }],
    })).toEqual({ ...response, source: null, assetId: "unconfigured-string", fetchedAt: null, status: "unavailable", unavailableReason: "not-configured" });
  });

  test("retains declared unavailable reasons", () => {
    for (const unavailableReason of ["not-configured", "unknown-asset", "invalid-range", "overloaded"] as const) {
      const unavailable: MarketPriceHistoryResponse = { ...response, status: "unavailable", points: [], unavailableReason };
      expect(parseHistoryResponse(unavailable)).toEqual(unavailable);
    }
  });

  test("keeps a string fetchedAt without imposing new date validation", () => {
    expect(parseHistoryResponse({ ...response, fetchedAt: "legacy-string" })?.fetchedAt).toBe("legacy-string");
  });

  test("retains positive decimal representations", () => {
    for (const value of ["1e-10", "0.01E+2", "1.00"]) {
      expect(parseHistoryResponse({ ...response, points: [{ ...point, value }] })?.points).toEqual([{ ...point, value }]);
    }
  });

  test.each([
    "base:0x1111111111111111111111111111111111111111",
    "base:0x0000000000000000000000000000000000000000",
  ])("resolves canonical dynamic identities without casts: %s", (assetId) => {
    const identity = resolveMarketPriceAssetIdentity(assetId);
    expect(identity?.assetId).toBe(assetId);
    expect(identity?.chainId).toBe(8453);
    expect(String(identity?.contractAddress)).toBe(assetId.slice(5));
  });

  test.each([
    "base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "base:0x1234",
    "base:0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "unknown",
  ])("rejects malformed or noncanonical dynamic identities: %s", (assetId) => {
    expect(resolveMarketPriceAssetIdentity(assetId)).toBeNull();
  });
});


describe("v2 source-bound histories", () => {
  const stock: MarketPriceHistoryResponse = { ...response, assetId: "nvdac", provider: "chainlink", source: expectedMarketPriceHistorySource("nvdac"), points: [{ ...point, session: "closed" as const }], coverage: { sampled: 32, observed: 1, gaps: [{ from: "2026-09-01T00:00:00.000Z", to: point.time, reason: "not-deployed" as const }] } };
  test("preserves observed sessions and explicit coverage", () => {
    expect(parseHistoryResponse(stock)).toEqual(stock);
  });
  test("rejects incompatible sources, sessions, ordering, bounds and coverage", () => {
    for (const invalid of [
      { ...stock, provider: "codex", source: response.source },
      { ...stock, coverage: undefined },
      { ...stock, status: "empty", points: [], coverage: undefined },
      { ...stock, coverage: { sampled: 32, observed: 1, gaps: [] } },
      { ...stock, status: "empty", points: [], coverage: { sampled: 32, observed: 0, gaps: [] } },
      { ...stock, source: expectedMarketPriceHistorySource("aaplc") },
      { ...response, points: [{ ...point, session: "open" }] },
      { ...response, points: [point, point] },
      { ...response, points: [{ ...point, time: "2026-09-08T00:00:00.000Z" }, point] },
      { ...stock, points: Array.from({ length: 33 }, (_, index) => ({ ...point, time: new Date(Date.parse(point.time) + index * 1000).toISOString() })), coverage: undefined },
      { ...stock, coverage: { sampled: 32, observed: 2, gaps: [] } },
      { ...stock, coverage: { sampled: 0, observed: 1, gaps: [] } },
      { ...stock, coverage: { sampled: 33, observed: 1, gaps: [] } },
      { ...response, coverage: { sampled: 1, observed: 1, gaps: [] } },
    ]) expect(parseHistoryResponse(invalid)).toBeNull();
  });
});
