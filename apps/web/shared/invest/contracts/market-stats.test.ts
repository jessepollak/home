import { describe, expect, test } from "bun:test";
import { parseMarketStatsResponse } from "./market-stats";

import type { MarketStatsResponse, TokenRisk } from "./market-stats";
import { resolveMarketPriceAssetIdentity } from "./market-price-history";

const response: MarketStatsResponse = {
  version: 1,
  provider: "codex",
  assetId: "cbbtc",
  currency: "USD",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  status: "ready",
  stats: { marketCapUsd: { atoms: "12345", scale: 2 } },
};

const identity = resolveMarketPriceAssetIdentity("cbbtc");
if (!identity) throw new Error("Expected configured asset");
const contractAddress = identity.contractAddress.toLowerCase();
const risk: TokenRisk = {
  source: "goplus", chainId: 8453, contractAddress, status: "ready",
  checkedAt: "2026-10-05T12:00:00.000Z",
  signals: {
    honeypot: "reported", cannotSellAll: "unknown", transferPausable: "absent",
    blacklist: "absent", taxModifiable: "absent", personalTaxModifiable: "absent",
    buyTax: { state: "reported", fraction: { atoms: "5", scale: 2 } },
    sellTax: { state: "reported", fraction: { atoms: "1", scale: 0 } },
    transferTax: { state: "unknown" },
  },
};

describe("market stats contract", () => {
  test("rejects malformed or inconsistent stats without retaining partial stats", () => {
    for (const value of [
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
    ]) expect(parseMarketStatsResponse(value)).toBeNull();
  });

  test("accepts additive risk on v1, including stale and non-data states", () => {
    expect(parseMarketStatsResponse(response)).toEqual(response);
    for (const status of ["ready", "stale"] as const) {
      const value = { ...response, risk: { ...risk, status } };
      expect(parseMarketStatsResponse(value)).toEqual(value);
    }
    for (const status of ["unsupported", "throttled", "error"] as const) {
      const value: MarketStatsResponse = { ...response, risk: { source: "goplus", chainId: 8453, contractAddress, status, checkedAt: null } };
      expect(parseMarketStatsResponse(value)).toEqual(value);
    }
  });

  test("risk is bound to configured and dynamic asset contracts, never a symbol", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const dynamic: MarketStatsResponse = { ...response, assetId: `base:${address}`, risk: { ...risk, contractAddress: address } };
    expect(parseMarketStatsResponse(dynamic)).toEqual(dynamic);
    for (const value of [
      { ...response, risk: { ...risk, contractAddress: address } },
      { ...dynamic, risk },
      { ...response, assetId: null, risk },
      { ...response, risk: { ...risk, chainId: 1 } },
    ]) expect(parseMarketStatsResponse(value)).toBeNull();
  });

  test("rejects malformed risk and inconsistent status data instead of dropping it", () => {
    for (const invalid of [null, [], {},
      { ...risk, source: "other" }, { ...risk, status: "safe" },
      { ...risk, contractAddress: contractAddress.toUpperCase() },
      { ...risk, contractAddress: "0x1234" },
      { ...risk, checkedAt: null }, { ...risk, checkedAt: "invalid" },
      { ...risk, checkedAt: "2026-10-05" }, { ...risk, signals: undefined },
      { ...risk, signals: {} }, { ...risk, signals: { ...risk.signals, honeypot: "0" } },
      { ...risk, status: "error" }, { ...risk, status: "unsupported", checkedAt: null },
      { ...risk, status: "throttled", signals: undefined },
    ]) expect(parseMarketStatsResponse({ ...response, risk: invalid })).toBeNull();
  });

  test("accepts exact tax fractions only within (0, 1] and enforces tax state data", () => {
    for (const fraction of [{ atoms: "1", scale: 36 }, { atoms: "100", scale: 2 }]) {
      expect(parseMarketStatsResponse({ ...response, risk: {
        ...risk, signals: { ...risk.signals, buyTax: { state: "reported", fraction } },
      } })).not.toBeNull();
    }
    for (const invalid of [
      { state: "reported" }, { state: "absent", fraction: { atoms: "0", scale: 0 } },
      { state: "unknown", fraction: { atoms: "1", scale: 0 } }, { state: "zero" },
      ...[null, {}, { atoms: "0", scale: 0 }, { atoms: "101", scale: 2 },
        { atoms: "-1", scale: 0 }, { atoms: "01", scale: 0 },
        { atoms: "1", scale: 37 }, { atoms: "1", scale: -1 }, { atoms: "1", scale: 0.5 },
      ].map((fraction) => ({ state: "reported", fraction })),
    ]) expect(parseMarketStatsResponse({ ...response, risk: {
      ...risk, signals: { ...risk.signals, buyTax: invalid },
    } })).toBeNull();
  });

  test("keeps absent stats absent rather than inventing zero values", () => {
    expect(parseMarketStatsResponse({ ...response, stats: { extra: "ignored", marketCapUsd: undefined } })?.stats).toEqual({});
  });

  test("retains valid empty responses without inventing stats", () => {
    for (const status of ["ready", "unavailable", "error"] as const) {
      const empty = { ...response, assetId: null, fetchedAt: null, status, stats: {} };
      expect(parseMarketStatsResponse(empty)).toEqual(empty);
    }
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
