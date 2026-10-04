import { describe, expect, test } from "bun:test";
import { parseMarketStatsResponse } from "./market-stats";

import type { MarketStatsResponse } from "./market-stats";

const response: MarketStatsResponse = {
  version: 1,
  provider: "codex",
  assetId: "cbbtc",
  currency: "USD",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  status: "ready",
  stats: { marketCapUsd: { atoms: "12345", scale: 2 } },
};

describe("market stats contract", () => {
  test.each([
    null,
    [],
    { ...response, version: 2 },
    { ...response, provider: "other" },
    { ...response, assetId: "unknown" },
    { ...response, assetId: undefined },
    { ...response, currency: undefined },
    { ...response, currency: "EUR" },
    { ...response, fetchedAt: "invalid" },
    { ...response, status: "partial" },
    { ...response, stats: undefined },
    { ...response, stats: [] },
    { ...response, status: "unavailable" },
    { ...response, status: "error" },
    { ...response, unavailableReason: "not-configured" },
    { ...response, status: "unavailable", stats: {}, unavailableReason: "unknown" },
    ...[
      null,
      {},
      { atoms: "01", scale: 0 },
      { atoms: "-1", scale: 0 },
      { atoms: "1", scale: 37 },
      { atoms: "1", scale: 0.5 },
      { atoms: "1", scale: -1 },
    ].map((invalid) => ({ ...response, stats: { ...response.stats, liquidityUsd: invalid } })),
  ].map((value) => ({ value })))("rejects malformed or inconsistent stats without retaining partial stats: %j", ({ value }) => {
    expect(parseMarketStatsResponse(value)).toBeNull();
  });

  test("keeps absent stats absent rather than inventing zero values", () => {
    expect(parseMarketStatsResponse({ ...response, stats: { extra: "ignored", marketCapUsd: undefined } })?.stats).toEqual({});
  });

  test.each(["ready", "unavailable", "error"])("retains a valid empty %s response", (status) => {
    const empty = { ...response, assetId: null, fetchedAt: null, status, stats: {} };
    expect(parseMarketStatsResponse(empty)).toEqual(empty);
  });

  test("accepts canonical dynamic identities and exact decimal bounds", () => {
    const dynamic: MarketStatsResponse = {
      ...response,
      assetId: "base:0x1111111111111111111111111111111111111111",
      stats: { volume24hUsd: { atoms: "0", scale: 36 } },
    };
    expect(parseMarketStatsResponse(dynamic)).toEqual(dynamic);
  });
});
