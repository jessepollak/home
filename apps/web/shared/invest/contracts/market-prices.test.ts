import { describe, expect, test } from "bun:test";
import { parseMarketPricesResponse } from "./market-prices";

const snapshot = {
  assetId: "cbbtc",
  displayPrice: "$64210.5",
  asOf: "2026-09-07T20:30:00.000Z",
  sourceLabel: "Codex",
};
import type { MarketPricesResponse } from "./market-prices";

const response: MarketPricesResponse = {
  version: 1,
  provider: "codex",
  fetchedAt: "2026-09-07T20:30:00.000Z",
  markets: { crypto: { status: "ready", snapshots: [snapshot] } },
};

describe("market prices contract", () => {
  test("rejects malformed envelopes and snapshots without returning a partial ready market", () => {
    for (const value of [
      null,
      [],
      { ...response, version: 2 },
      { ...response, provider: "other" },
      { ...response, fetchedAt: "invalid" },
      { ...response, markets: undefined },
      { ...response, markets: { crypto: { status: "ready" } } },
      { ...response, markets: { crypto: { status: "partial", snapshots: [snapshot] } } },
      ...[
        { ...snapshot, assetId: "unknown" },
        { ...snapshot, displayPrice: "" },
        { ...snapshot, asOf: "invalid" },
        { ...snapshot, sourceLabel: "" },
        { ...snapshot, sourceUrl: null },
        { ...snapshot, session: "closed", checkedAt: snapshot.asOf },
        { ...snapshot, checkedAt: snapshot.asOf },
        {},
      ].map((invalid) => ({ ...response, markets: { crypto: { status: "ready", snapshots: [snapshot, invalid] } } })),
    ]) expect(parseMarketPricesResponse(value)).toBeNull();
  });

  test("keeps optional metadata normalization and strips unknown fields", () => {
    expect(parseMarketPricesResponse({
      ...response,
      unavailableReason: "unknown",
      extra: true,
      markets: {
        crypto: { status: "ready", snapshots: [{ ...snapshot, changeLabel: 2, sourceUrl: undefined }] },
        stock: { status: "error", message: 3 },
        meme: { status: "loading", snapshots: [{}] },
      },
    })).toEqual({
      ...response,
      markets: {
        crypto: { status: "ready", snapshots: [snapshot] },
        stock: { status: "error" },
        meme: { status: "loading" },
      },
    });
  });

  test("retains explicitly empty ready markets and empty FX lists", () => {
    const empty: MarketPricesResponse = { ...response, markets: { crypto: { status: "ready", snapshots: [] } }, fx: [] };
    expect(parseMarketPricesResponse(empty)).toEqual(empty);
  });

  test("normalizes an unavailable FX quote's missing factor to null", () => {
    expect(parseMarketPricesResponse({ ...response, fx: [{ quoteCurrency: "USD", status: "unavailable" }] })?.fx)
      .toEqual([{ quoteCurrency: "USD", status: "unavailable", quoteUnitsPerUsd: null }]);
  });

  test("rejects malformed FX entries rather than dropping them", () => {
    for (const invalid of [
      { quoteCurrency: "XYZ", status: "unavailable" },
      { quoteCurrency: "USD", status: "fresh" },
      { quoteCurrency: "USD", status: "fresh", quoteUnitsPerUsd: { atoms: "01", scale: 0 } },
      { quoteCurrency: "USD", status: "fresh", quoteUnitsPerUsd: { atoms: "1", scale: 10_001 } },
      { quoteCurrency: "USD", status: "fresh", quoteUnitsPerUsd: { atoms: "1", scale: 0.5 } },
      { quoteCurrency: "USD", status: "unavailable", quoteUnitsPerUsd: { atoms: "1", scale: 0 } },
    ]) expect(parseMarketPricesResponse({ ...response, fx: [{ quoteCurrency: "USD", status: "unavailable" }, invalid] })).toBeNull();
  });
});
