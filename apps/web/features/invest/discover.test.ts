import { describe, expect, test } from "bun:test";
import { cryptoAssets, stockAssets, type InvestAsset } from "@/config/invest-assets";
import {
  STOCK_PREVIEW_COUNT,
  discoverShelves,
  getDiscoverAsset,
  getDiscoverShelf,
  getShelfAssets,
  getShelfPreviewAssets,
} from "./discover";

const trendingMeme = {
  id: "base:0x1111111111111111111111111111111111111111",
  category: "meme",
  displayName: "Higher",
  displaySymbol: "HIGHER",
  initials: "HI",
  chainId: 8453,
  contractAddress: "0x1111111111111111111111111111111111111111",
  availability: "informational",
  descriptor: "Trending on Base",
  representation: {
    tokenSymbol: "HIGHER",
    decimals: 18,
    relationship: "Base ERC-20 token; the display and token symbols are the same.",
  },
  contractUrl: "https://basescan.org/token/0x1111111111111111111111111111111111111111",
} as const satisfies InvestAsset;

describe("invest discovery catalog", () => {
  test("keeps Stocks, Crypto, then Memes shelves with the signed-off preview roster", () => {
    expect(discoverShelves.map((shelf) => shelf.title)).toEqual([
      "Stocks",
      "Crypto",
      "Memes",
    ]);
    expect(STOCK_PREVIEW_COUNT).toBe(6);
    expect(discoverShelves[0].previewCount).toBe(STOCK_PREVIEW_COUNT);
    expect(getShelfPreviewAssets(discoverShelves[0]).map((asset) => asset.displaySymbol)).toEqual([
      "NVDA",
      "META",
      "AAPL",
      "GOOGL",
      "AMZN",
      "MSFT",
    ]);
    expect(getShelfAssets(discoverShelves[0]).map((asset) => asset.id)).toEqual(
      stockAssets.map((asset) => asset.id),
    );
    expect(getShelfAssets(discoverShelves[0])).toHaveLength(10);
    expect(getShelfPreviewAssets(discoverShelves[0])).toHaveLength(STOCK_PREVIEW_COUNT);
    expect(getShelfPreviewAssets(discoverShelves[0]).map((asset) => asset.displaySymbol)).not.toContain(
      "TSLA",
    );
    expect(getShelfPreviewAssets(discoverShelves[1]).map((asset) => asset.displaySymbol)).toEqual([
      "BTC",
      "XRP",
      "DOGE",
      "LTC",
    ]);
    expect(getShelfPreviewAssets(discoverShelves[2])).toEqual([]);
    expect(getShelfAssets(discoverShelves[2])).toEqual([]);
  });

  test("keeps Cardano on the Crypto category list and off the hub preview", () => {
    const crypto = getDiscoverShelf("crypto");
    expect(crypto?.assets.map((asset) => asset.id)).toEqual(
      cryptoAssets.map((asset) => asset.id),
    );
    expect(crypto?.assets.map((asset) => asset.displaySymbol)).toContain("ADA");
    expect(
      getShelfPreviewAssets(crypto!).map((asset) => asset.displaySymbol),
    ).not.toContain("ADA");
    expect(getDiscoverAsset("cbbtc")?.displayName).toBe("Bitcoin");
  });

  test("populates Memes only from the supplied trending catalog", () => {
    const memes = getDiscoverShelf("memes");
    expect(getShelfAssets(memes!, [trendingMeme]).map((asset) => asset.displaySymbol)).toEqual([
      "HIGHER",
    ]);
    expect(getDiscoverAsset(trendingMeme.id, [trendingMeme])?.displayName).toBe("Higher");
    expect(getDiscoverAsset("degen")).toBeTruthy();
    expect(getShelfPreviewAssets(memes!).map((asset) => asset.id)).not.toContain("degen");
  });
});
