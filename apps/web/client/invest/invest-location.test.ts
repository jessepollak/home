import { describe, expect, test } from "bun:test";
import { parseShellLocation } from "@/config/shell-location";
import { investHref, investViewFromLocation } from "./invest-location";

const DYNAMIC_ASSET_ID = "base:0x1111111111111111111111111111111111111111";

describe("invest location", () => {
  test("maps flat canonical paths to hub, category, and detail views", () => {
    expect(investViewFromLocation({ shelf: null, asset: null })).toEqual({ screen: "hub" });
    expect(investViewFromLocation({ shelf: "crypto", asset: null })).toEqual({
      screen: "category",
      shelfId: "crypto",
    });
    expect(investViewFromLocation({ shelf: null, asset: "cbbtc" })).toEqual({
      screen: "detail",
      assetId: "cbbtc",
      from: "hub",
    });
  });

  test("restores canonical dynamic Base detail locations before the catalog loads", () => {
    expect(investViewFromLocation({ shelf: null, asset: DYNAMIC_ASSET_ID })).toEqual({
      screen: "detail",
      assetId: DYNAMIC_ASSET_ID,
      from: "hub",
    });
    expect(investHref({ screen: "detail", assetId: DYNAMIC_ASSET_ID, from: "memes" })).toBe(
      `/invest/${DYNAMIC_ASSET_ID}`,
    );
  });

  test("builds one-segment hrefs for each invest screen", () => {
    expect(investHref({ screen: "hub" })).toBe("/invest");
    expect(investHref({ screen: "category", shelfId: "stocks" })).toBe("/invest/stocks");
    expect(investHref({ screen: "detail", assetId: "cbbtc", from: "hub" })).toBe("/invest/cbbtc");
    // The category context is local state: the flat path carries the asset only.
    expect(investHref({ screen: "detail", assetId: "cbbtc", from: "crypto" })).toBe("/invest/cbbtc");
  });

  test("round-trips every emitted href through the shell pathname parser", () => {
    const views = [
      { screen: "hub" },
      { screen: "category", shelfId: "memes" },
      { screen: "detail", assetId: DYNAMIC_ASSET_ID, from: "hub" },
    ] as const;
    for (const view of views) {
      const location = parseShellLocation(investHref(view));
      expect(location.panel).toBe("invest");
      // A flat detail path has no category context; in-app state reattaches it.
      expect(investViewFromLocation(location)).toEqual(view.screen === "detail"
        ? { screen: "detail", assetId: view.assetId, from: "hub" }
        : view);
    }
  });
});
