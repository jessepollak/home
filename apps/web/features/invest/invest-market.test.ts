import { describe, expect, test } from "bun:test";
import { getMarketDisplay, type MarketDataState } from "./invest-market";

describe("invest market display", () => {
  test("never coerces unavailable, loading, failed, or missing crypto prices to zero", () => {
    const states: MarketDataState[] = [
      { status: "unavailable" },
      { status: "loading" },
      { status: "error", message: "Source timed out" },
      { status: "ready", snapshots: [] },
    ];

    for (const state of states) {
      expect(getMarketDisplay("nvdac", state).value).toBe("—");
      expect(getMarketDisplay("cbbtc", state).value).toBe("—");
      expect(getMarketDisplay("cbbtc", state).value).not.toBe("0");
    }
  });

  test("formats source-supplied USD values while retaining nonnumeric caller display values", () => {
    const state: MarketDataState = {
      status: "ready",
      snapshots: [
        {
          assetId: "degen",
          displayPrice: "Caller supplied",
          asOf: "2026-09-07T12:00:00Z",
          sourceLabel: "Fixture source",
          sourceUrl: "https://example.com/fixture",
        },
      ],
    };

    expect(getMarketDisplay("degen", state)).toEqual({
      value: "Caller supplied",
      detail: "Fixture source · 2026-09-07T12:00:00Z",
      sourceUrl: "https://example.com/fixture",
      tone: "ready",
    });
    expect(getMarketDisplay("toshi", state).detail).toBe("No price supplied");
    expect(getMarketDisplay("nvdac", {
      status: "ready",
      snapshots: [{
        assetId: "nvdac",
        displayPrice: "$231.708792875",
        asOf: "2026-09-07T12:00:00Z",
        sourceLabel: "Fixture source",
        changeLabel: "+1.25%",
      }],
    })).toMatchObject({
      value: "$231.71",
      changeLabel: "+1.25%",
    });
    expect(getMarketDisplay("cate", {
      status: "ready",
      snapshots: [{
        assetId: "cate",
        displayPrice: "$0.003977",
        asOf: "2026-09-07T12:00:00Z",
        sourceLabel: "Fixture source",
        changeLabel: "+9.8%",
      }],
    })).toMatchObject({
      value: "$0.003977",
      changeLabel: "+9.80%",
    });
  });

  test("converts USD snapshots into the selected local presentation currency", () => {
    const state: MarketDataState = {
      status: "ready",
      snapshots: [
        {
          assetId: "nvdac",
          displayPrice: "$231.708792875",
          asOf: "2026-09-07T12:00:00Z",
          sourceLabel: "Fixture source",
          changeLabel: "+1.25%",
        },
      ],
    };

    expect(
      getMarketDisplay("nvdac", state, {
        valueCurrency: "IDR",
        quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
      }),
    ).toMatchObject({
      value: "Rp 3,805,816.92",
      changeLabel: "+1.25%",
    });
    expect(
      getMarketDisplay("nvdac", state, {
        valueCurrency: "IDR",
        quoteUnitsPerUsd: null,
      }).value,
    ).toBe("—");
  });

  test("uses a stable error fallback when no provider message is present", () => {
    expect(getMarketDisplay("aaplc", { status: "error" })).toEqual({
      value: "—",
      detail: "Pricing unavailable",
      tone: "error",
    });
  });
});
