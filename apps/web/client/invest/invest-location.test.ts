import { describe, expect, test } from "bun:test";
import { investHref, investViewFromSearch } from "./invest-location";

describe("invest location", () => {
  test("maps hub, category, and detail search params", () => {
    expect(investViewFromSearch({})).toEqual({ screen: "hub" });
    expect(investViewFromSearch({ panel: "invest", shelf: "crypto" })).toEqual({
      screen: "category",
      shelfId: "crypto",
    });
    expect(
      investViewFromSearch({
        panel: "invest",
        shelf: "crypto",
        asset: "cbbtc",
      }),
    ).toEqual({
      screen: "detail",
      assetId: "cbbtc",
      from: "crypto",
    });
    expect(investViewFromSearch({ panel: "invest", asset: "cbbtc" })).toEqual({
      screen: "detail",
      assetId: "cbbtc",
      from: "hub",
    });
  });

  test("restores canonical dynamic Base detail locations before the catalog loads", () => {
    const dynamicId = "base:0x1111111111111111111111111111111111111111";
    expect(
      investViewFromSearch({
        panel: "invest",
        shelf: "memes",
        asset: dynamicId,
      }),
    ).toEqual({
      screen: "detail",
      assetId: dynamicId,
      from: "memes",
    });
    expect(
      investHref({ screen: "detail", assetId: dynamicId, from: "memes" }),
    ).toBe(
      "/dashboard?panel=invest&shelf=memes&asset=base%3A0x1111111111111111111111111111111111111111",
    );
  });

  test("falls back to hub for unknown shelf or asset ids", () => {
    expect(investViewFromSearch({ panel: "invest", shelf: "forex" })).toEqual({
      screen: "hub",
    });
    expect(investViewFromSearch({ panel: "invest", asset: "not-an-asset" })).toEqual({
      screen: "hub",
    });
    expect(
      investViewFromSearch({
        panel: "invest",
        asset: "base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toEqual({ screen: "hub" });
  });

  test("builds dashboard hrefs for each invest screen", () => {
    expect(investHref({ screen: "hub" })).toBe("/dashboard?panel=invest");
    expect(investHref({ screen: "category", shelfId: "stocks" })).toBe(
      "/dashboard?panel=invest&shelf=stocks",
    );
    expect(
      investHref({ screen: "detail", assetId: "cbbtc", from: "hub" }),
    ).toBe("/dashboard?panel=invest&asset=cbbtc");
    expect(
      investHref({ screen: "detail", assetId: "cbbtc", from: "crypto" }),
    ).toBe("/dashboard?panel=invest&shelf=crypto&asset=cbbtc");
  });
});
