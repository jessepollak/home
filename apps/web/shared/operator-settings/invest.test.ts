import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import {
  INVEST_HIDE_ALL, INVEST_SETTINGS_DEFAULTS, isInvestAssetVisible, isInvestCategoryVisible,
  parseInvestSettings, parseInvestSettingsWrite,
} from "./invest";

describe("invest settings", () => {
  test("read tolerates removed catalog ids, de-duplicates and canonicalizes", () => {
    expect(parseInvestSettings({ hiddenCategories: ["meme", "stock", "stock", "retired"], hiddenAssets: ["toshi", "removed-id", "cbbtc", "toshi", "nvdac"] }))
      .toEqual({ hiddenCategories: ["stock", "meme"], hiddenAssets: ["nvdac", "cbbtc", "toshi"] });
    expect(parseInvestSettings({ hiddenCategories: [], hiddenAssets: [] })).toEqual({ hiddenCategories: [], hiddenAssets: [] });
  });

  test("read accepts stored retired ids beyond the current catalog size, while write stays bounded", () => {
    const hiddenAssets = ["cbbtc", ...Array.from({ length: investAssets.length + 1 }, (_, index) => `retired-${index}`)];
    expect(parseInvestSettings({ hiddenCategories: [], hiddenAssets }))
      .toEqual({ hiddenCategories: [], hiddenAssets: ["cbbtc"] });
    expect(parseInvestSettingsWrite({ hiddenCategories: [], hiddenAssets })).toBeNull();
    expect(parseInvestSettings({ hiddenCategories: [], hiddenAssets: Array(257).fill("retired") })).toBeNull();
  });

  test("write accepts only configured ids and categories, in canonical order", () => {
    expect(parseInvestSettingsWrite({ hiddenCategories: ["meme", "crypto"], hiddenAssets: ["degen", "cbbtc", "nvdac"] }))
      .toEqual({ hiddenCategories: ["crypto", "meme"], hiddenAssets: ["nvdac", "cbbtc", "degen"] });
    for (const value of [
      { hiddenCategories: ["retired"], hiddenAssets: [] },
      { hiddenCategories: [], hiddenAssets: ["retired"] },
      { hiddenCategories: ["stock", "stock"], hiddenAssets: [] },
      { hiddenCategories: [], hiddenAssets: ["cbbtc", "cbbtc"] },
      { hiddenCategories: [], hiddenAssets: [], extra: true },
      { hiddenCategories: [1], hiddenAssets: [] },
      { hiddenCategories: [], hiddenAssets: "cbbtc" },
      { hiddenCategories: [], hiddenAssetIds: [] },
    ]) expect(parseInvestSettingsWrite(value)).toBeNull();
  });

  test("visibility hides category members and individual assets, but defaults show the catalog", () => {
    const bitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;
    expect(isInvestAssetVisible(INVEST_SETTINGS_DEFAULTS, bitcoin)).toBe(true);
    expect(isInvestCategoryVisible(INVEST_HIDE_ALL, "meme")).toBe(false);
    expect(isInvestAssetVisible({ hiddenCategories: ["crypto"], hiddenAssets: [] }, bitcoin)).toBe(false);
    expect(isInvestAssetVisible({ hiddenCategories: [], hiddenAssets: ["cbbtc"] }, bitcoin)).toBe(false);
  });
});
