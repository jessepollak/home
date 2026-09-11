import { describe, expect, test } from "bun:test";
import { investPortfolioAssets } from "@/config/portfolio-assets";
import { presentHomeBalanceMark, presentHomeBalanceRow } from "./home-balance-row";

describe("presentHomeBalanceRow", () => {
  test("shows an unpriced cash quantity without appending its token ticker", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:local",
        group: "cash",
        name: "Local currency",
        displayBalance: "2,500.00 LCLX",
        currencyCode: "LCL",
      }),
    ).toEqual({
      visualBalance: "2,500.00",
      accessibleBalance: "2,500.00 LCLX",
      tone: "default",
    });
  });

  test("repairs the muted tone from a legacy cached unpriced cash row", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:cached-local",
        group: "cash",
        name: "Local currency",
        displayBalance: "0.00 LCLX",
        currencyCode: "LCL",
        tone: "muted",
      }),
    ).toEqual({
      visualBalance: "0.00",
      accessibleBalance: "0.00 LCLX",
      tone: "default",
    });
  });

  test("does not alter priced, unknown, asset, or failed-read values", () => {
    expect(
      presentHomeBalanceRow({
        id: "cash:priced",
        group: "cash",
        name: "US dollar",
        displayBalance: "$25.00",
        currencyCode: "USD",
      }),
    ).toEqual({ visualBalance: "$25.00", tone: undefined });

    expect(
      presentHomeBalanceRow({
        id: "cash:unknown",
        group: "cash",
        name: "Local currency",
        displayBalance: "—",
        currencyCode: "LCL",
        tone: "muted",
      }),
    ).toEqual({ visualBalance: "—", tone: "muted" });

    expect(
      presentHomeBalanceRow({
        id: "asset:token",
        group: "asset",
        name: "Token",
        displayBalance: "25.00 TKN",
      }),
    ).toEqual({ visualBalance: "25.00 TKN", tone: undefined });

    expect(
      presentHomeBalanceRow({
        id: "cash:failed",
        group: "cash",
        name: "Local currency",
        displayBalance: "Unavailable",
        currencyCode: "LCL",
        tone: "error",
      }),
    ).toEqual({ visualBalance: "Unavailable", tone: "error" });
  });
});

describe("presentHomeBalanceMark", () => {
  test("passes presentation cash currencies and their symbols for flags", () => {
    expect(
      presentHomeBalanceMark({
        id: "cash:usd",
        assetKey: "cash:usd",
        group: "cash",
        name: "US dollar",
        displayBalance: "$25.00",
        currencyCode: "USD",
      }),
    ).toEqual({
      assetKey: "cash:usd",
      name: "US dollar",
      currency: "USD",
      symbol: "$",
      imageUrl: null,
      pending: false,
    });

    expect(
      presentHomeBalanceMark({
        id: "cash:idr",
        assetKey: "cash:idr",
        group: "cash",
        name: "Indonesian rupiah",
        displayBalance: "Rp 2,500.00",
        currencyCode: "IDR",
      }),
    ).toMatchObject({ currency: "IDR", symbol: "Rp" });

    expect(
      presentHomeBalanceMark({
        id: "cash:unknown",
        assetKey: "cash:unknown",
        group: "cash",
        name: "Local currency",
        displayBalance: "—",
        currencyCode: "LCL",
      }),
    ).toMatchObject({ currency: "LCL", symbol: "LCL" });
  });

  test("keeps leftover fiat asset rows eligible for flags and never flags crypto", () => {
    expect(
      presentHomeBalanceMark({
        id: "asset:eurc",
        assetKey: "asset:eurc",
        group: "asset",
        name: "Euro",
        detail: "EURC",
        displayBalance: "€10.00",
        currencyCode: "EUR",
      }),
    ).toMatchObject({ currency: "EUR", symbol: "€" });

    expect(
      presentHomeBalanceMark({
        id: "asset:eth",
        assetKey: "eip155:8453/native",
        group: "asset",
        name: "Ethereum",
        detail: "ETH",
        displayBalance: "0.5 ETH",
      }),
    ).toMatchObject({ currency: null, symbol: "ETH" });

    expect(
      presentHomeBalanceMark({
        id: "asset:mislabelled",
        assetKey: "eip155:8453/native",
        group: "asset",
        name: "Ethereum",
        detail: "ETH",
        displayBalance: "0.5 ETH",
        currencyCode: "ETH",
      }),
    ).toMatchObject({ currency: null, symbol: "ETH" });
  });

  test("resolves the same configured stock and cbBTC images by stable asset key", () => {
    const nvidia = investPortfolioAssets.find((asset) => asset.id === "nvdac")!;
    const bitcoin = investPortfolioAssets.find((asset) => asset.id === "cbbtc")!;
    const images = {
      [nvidia.assetKey]: "https://icons.example.test/nvda.png",
      [bitcoin.assetKey]: "https://icons.example.test/cbbtc.png",
    };

    expect(
      presentHomeBalanceMark(
        {
          id: `asset:${nvidia.assetKey}`,
          assetKey: nvidia.assetKey,
          group: "asset",
          name: nvidia.name,
          detail: nvidia.symbol,
          displayBalance: "1.0000 NVDAc",
        },
        { images, pending: true },
      ),
    ).toEqual({
      assetKey: nvidia.assetKey,
      name: "NVIDIA",
      symbol: "NV",
      imageUrl: images[nvidia.assetKey],
      pending: false,
      currency: null,
    });

    expect(
      presentHomeBalanceMark(
        {
          id: `asset:${bitcoin.assetKey}`,
          assetKey: bitcoin.assetKey,
          group: "asset",
          name: bitcoin.name,
          detail: bitcoin.symbol,
          displayBalance: "0.1000 cbBTC",
        },
        { images: {}, pending: true },
      ),
    ).toMatchObject({
      assetKey: bitcoin.assetKey,
      name: "Bitcoin",
      symbol: "BT",
      imageUrl: null,
      pending: true,
      currency: null,
    });
  });
});
