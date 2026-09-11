import { describe, expect, test } from "bun:test";
import {
  cryptoAssets,
  memeAssets,
  stockAssets,
  type InvestAsset,
} from "@/config/invest-assets";
import { investPortfolioAssets } from "@/config/portfolio-assets";
import {
  assetKeyForInvestAsset,
  assetMarkResolutionFromDiscover,
  presentInvestAssetMark,
  presentPortfolioAssetMark,
} from "./presentation";

describe("asset mark presentation", () => {
  test("normalizes already-fetched configured and meme images by stable asset key", () => {
    const degen = {
      ...memeAssets[0],
      imageUrl: " https://icons.example.test/degen.png ",
    } satisfies InvestAsset;
    const resolution = assetMarkResolutionFromDiscover({
      icons: {
        nvdac: "https://icons.example.test/nvda.png",
        unknown: "https://icons.example.test/unknown.png",
      },
      memeAssets: [degen],
    });

    expect(resolution).toEqual({
      images: {
        [assetKeyForInvestAsset(stockAssets[0])]:
          "https://icons.example.test/nvda.png",
        [assetKeyForInvestAsset(degen)]:
          "https://icons.example.test/degen.png",
      },
      pending: false,
    });
  });

  test("keeps configured stock identity and image resolution identical across surfaces", () => {
    const invest = stockAssets[0];
    const portfolio = investPortfolioAssets.find((asset) => asset.id === invest.id)!;
    const resolution = {
      images: {
        [assetKeyForInvestAsset(invest)]:
          "https://icons.example.test/nvda.png",
      },
      pending: true,
    };

    const investMark = presentInvestAssetMark(invest, resolution);
    const homeMark = presentPortfolioAssetMark(
      {
        assetKey: portfolio.assetKey,
        name: portfolio.name,
        symbol: portfolio.symbol,
        currency: null,
      },
      resolution,
    );

    expect(investMark).toEqual(homeMark);
    expect(investMark).toEqual({
      assetKey: assetKeyForInvestAsset(invest),
      name: "NVIDIA",
      symbol: "NV",
      imageUrl: "https://icons.example.test/nvda.png",
      pending: false,
      currency: null,
    });
  });

  test("keeps Degen and Toshi image, loading, and fallback marks identical across surfaces", () => {
    for (const configuredMeme of memeAssets) {
      const meme = {
        ...configuredMeme,
        imageUrl: `https://icons.example.test/${configuredMeme.id}.png`,
      } satisfies InvestAsset;
      const portfolio = investPortfolioAssets.find(
        (asset) => asset.id === configuredMeme.id,
      )!;
      const identity = {
        assetKey: portfolio.assetKey,
        name: portfolio.name,
        symbol: portfolio.symbol,
        currency: null,
      };
      const resolved = assetMarkResolutionFromDiscover({
        icons: {},
        memeAssets: [meme],
      });
      const loading = assetMarkResolutionFromDiscover({
        icons: {},
        pending: true,
      });
      const failed = assetMarkResolutionFromDiscover({ icons: {} });

      expect(presentInvestAssetMark(meme, resolved)).toEqual(
        presentPortfolioAssetMark(identity, resolved),
      );
      expect(presentInvestAssetMark(meme, resolved).imageUrl).toBe(
        meme.imageUrl,
      );
      expect(presentInvestAssetMark(configuredMeme, loading)).toEqual(
        presentPortfolioAssetMark(identity, loading),
      );
      expect(presentInvestAssetMark(configuredMeme, loading).pending).toBe(true);
      expect(presentInvestAssetMark(configuredMeme, failed)).toEqual(
        presentPortfolioAssetMark(identity, failed),
      );
      expect(presentInvestAssetMark(configuredMeme, failed)).toMatchObject({
        imageUrl: null,
        pending: false,
        symbol: configuredMeme.initials,
      });
    }
  });

  test("does not collapse native BTC into cbBTC image identity", () => {
    const cbbtc = cryptoAssets[0];
    const cbbtcKey = assetKeyForInvestAsset(cbbtc);
    const resolution = {
      images: { [cbbtcKey]: "https://icons.example.test/cbbtc.png" },
      pending: true,
    };

    expect(presentInvestAssetMark(cbbtc, resolution)).toMatchObject({
      assetKey: cbbtcKey,
      imageUrl: "https://icons.example.test/cbbtc.png",
      pending: false,
    });
    expect(
      presentPortfolioAssetMark(
        {
          assetKey: "bip122:000000000019d6689c085ae165831e93/native",
          name: "Bitcoin",
          symbol: "BTC",
          currency: null,
        },
        resolution,
      ),
    ).toEqual({
      assetKey: "bip122:000000000019d6689c085ae165831e93/native",
      name: "Bitcoin",
      symbol: "BT",
      imageUrl: null,
      pending: false,
      currency: null,
    });
  });

  test("only marks resolvable assets pending and keeps fiat currency explicit", () => {
    expect(
      presentInvestAssetMark(stockAssets[1], { images: {}, pending: true }),
    ).toMatchObject({ symbol: "ME", pending: true, currency: null });

    expect(
      presentPortfolioAssetMark(
        {
          assetKey: "cash:usd",
          name: "US dollar",
          symbol: "$",
          currency: "USD",
        },
        { pending: true },
      ),
    ).toEqual({
      assetKey: "cash:usd",
      name: "US dollar",
      symbol: "$",
      imageUrl: null,
      pending: false,
      currency: "USD",
    });
  });
});
