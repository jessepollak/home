import { describe, expect, test } from "bun:test";
import { parseHistoryResponse, resolveMarketPriceAssetIdentity } from "./market-price-history";

const point = { time: "2026-09-07T00:00:00.000Z", value: "64210.5" };
import type { MarketPriceHistoryResponse } from "./market-price-history";

const response: MarketPriceHistoryResponse = {
  version: 1, provider: "codex", assetId: "cbbtc", range: "1W", currency: "USD",
  fetchedAt: "2026-09-07T20:30:00.000Z", status: "ready", points: [point],
};

describe("market history contract", () => {
  test.each([
    null,
    [],
    { ...response, version: 2 },
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
  ].map((value) => ({ value })))("rejects malformed envelopes or points instead of completing a partial history: %j", ({ value }) => {
    expect(parseHistoryResponse(value)).toBeNull();
  });

  test.each(["ready", "empty", "unavailable", "error"])("preserves empty %s histories", (status) => {
    const empty = { ...response, status, points: [] };
    expect(parseHistoryResponse(empty)).toEqual(empty);
  });

  test("preserves legacy string identities and optional field normalization", () => {
    expect(parseHistoryResponse({
      ...response, assetId: "unconfigured-string", currency: undefined, fetchedAt: 1,
      status: "unavailable", unavailableReason: "not-configured", extra: true, points: [{ ...point, extra: true }],
    })).toEqual({ ...response, assetId: "unconfigured-string", fetchedAt: null, status: "unavailable", unavailableReason: "not-configured" });
  });

  test.each(["not-configured", "unknown-asset", "invalid-range", "overloaded"] as const)("retains declared unavailable reason %s", (unavailableReason) => {
    const unavailable: MarketPriceHistoryResponse = { ...response, status: "unavailable", points: [], unavailableReason };
    expect(parseHistoryResponse(unavailable)).toEqual(unavailable);
  });

  test("keeps a string fetchedAt without imposing new date validation", () => {
    expect(parseHistoryResponse({ ...response, fetchedAt: "legacy-string" })?.fetchedAt).toBe("legacy-string");
  });

  test("normalizes a missing fetchedAt to null", () => {
    expect(parseHistoryResponse({ ...response, fetchedAt: undefined })?.fetchedAt).toBeNull();
  });

  test.each(["1e-10", "0.01E+2", "1.00"])("retains positive decimal representation %s", (value) => {
    expect(parseHistoryResponse({ ...response, points: [{ ...point, value }] })?.points).toEqual([{ ...point, value }]);
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
