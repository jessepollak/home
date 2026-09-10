import { describe, expect, test } from "bun:test";
import { cryptoAssets, stockAssets } from "@/config/invest-assets";
import { investPortfolioAssets } from "@/config/portfolio-assets";
import {
  assetKeyForInvestAsset,
  presentInvestAssetMark,
  presentPortfolioAssetMark,
} from "./presentation";

describe("asset mark presentation", () => {
  test("keeps configured stock identity and image resolution identical across surfaces", () => {
    const invest = stockAssets[0];
    const portfolio = investPortfolioAssets.find((asset) => asset.id === invest.id)!;
    const resolution = {
      images: { nvdac: "https://icons.example.test/nvda.png" },
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

  test("does not collapse cbBTC into native BTC identity", () => {
    const cbbtc = cryptoAssets[0];
    expect(presentInvestAssetMark(cbbtc)).toEqual({
      assetKey:
        "eip155:8453/erc20:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
      name: "Bitcoin",
      symbol: "BT",
      imageUrl: null,
      pending: false,
      currency: null,
    });
  });

  test("only marks configured unresolved assets pending and keeps fiat currency explicit", () => {
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
