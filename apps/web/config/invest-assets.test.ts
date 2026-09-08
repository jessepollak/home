import { describe, expect, test } from "bun:test";
import { getAssetPresentation } from "./asset-presentation";
import {
  BASE_CHAIN_ID,
  cryptoAssets,
  findInvestAssetByAddress,
  initialsFromSymbol,
  investAssets,
  investSources,
  memeAssets,
  shortenContractAddress,
  stockAssets,
  trendingTokenId,
} from "./invest-assets";

const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;

describe("invest asset registry", () => {
  test("keeps the approved stock roster, stable IDs, and Base identities", () => {
    expect(stockAssets.map((asset) => asset.id)).toEqual([
      "nvdac",
      "metac",
      "aaplc",
      "googlc",
    ]);
    expect(stockAssets.map((asset) => asset.displaySymbol)).toEqual([
      "NVDA",
      "META",
      "AAPL",
      "GOOGL",
    ]);
    expect(stockAssets.map((asset) => asset.representation.tokenSymbol)).toEqual([
      "NVDAc",
      "METAc",
      "AAPLc",
      "GOOGLc",
    ]);

    for (const asset of stockAssets) {
      expect(asset.chainId).toBe(BASE_CHAIN_ID);
      expect(asset.contractAddress).toMatch(evmAddressPattern);
      expect(asset.availability).toBe("restricted");
      expect(asset.descriptor).toContain("Regulation S");
      expect(asset.displaySymbol).not.toBe(asset.representation.tokenSymbol);
    }
  });

  test("keeps original stock market-source links unchanged", () => {
    expect(investSources.stockRoster.url).toBe("https://www.base.org/stocks");
    expect(investSources.stockAnnouncement.url).toBe(
      "https://blog.base.org/tokenized-stocks",
    );
  });

  test("registers only sourced Coinbase-wrapped crypto majors on Base", () => {
    expect(
      cryptoAssets.map((asset) => ({
        id: asset.id,
        display: asset.displaySymbol,
        token: asset.representation.tokenSymbol,
        decimals: asset.representation.decimals,
        address: asset.contractAddress,
      })),
    ).toEqual([
      {
        id: "cbbtc",
        display: "BTC",
        token: "cbBTC",
        decimals: 8,
        address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      },
      {
        id: "cbxrp",
        display: "XRP",
        token: "cbXRP",
        decimals: 6,
        address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
      },
      {
        id: "cbdoge",
        display: "DOGE",
        token: "cbDOGE",
        decimals: 8,
        address: "0xcbD06E5A2B0C65597161de254AA074E489dEb510",
      },
      {
        id: "cbltc",
        display: "LTC",
        token: "cbLTC",
        decimals: 8,
        address: "0xcb17C9Db87B595717C857a08468793f5bAb6445F",
      },
      {
        id: "cbada",
        display: "ADA",
        token: "cbADA",
        decimals: 6,
        address: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c",
      },
    ]);

    for (const asset of cryptoAssets) {
      expect(asset.chainId).toBe(BASE_CHAIN_ID);
      expect(asset.representation.issuer).toBe("Coinbase");
      expect(asset.representation.relationship).toContain("Home does not provide redemption");
      expect(asset.displaySymbol).not.toBe(asset.representation.tokenSymbol);
    }
  });

  test("does not treat staking wrappers as par native assets", () => {
    const tokenSymbols: string[] = cryptoAssets.map(
      (asset) => asset.representation.tokenSymbol,
    );
    const displaySymbols: string[] = cryptoAssets.map(
      (asset) => asset.displaySymbol,
    );
    const assetIds: string[] = investAssets.map((asset) => asset.id);

    expect(tokenSymbols).not.toContain("cbETH");
    expect(displaySymbols).not.toContain("ETH");
    expect(assetIds).not.toContain("cbsol");
  });

  test("treats the meme roster as holdings identity, not the discover source", () => {
    expect(memeAssets.map((asset) => asset.displaySymbol)).toEqual(["DEGEN", "TOSHI"]);
    expect(memeAssets.map((asset) => asset.representation.tokenSymbol)).toEqual([
      "DEGEN",
      "TOSHI",
    ]);
    expect(memeAssets.map((asset) => asset.representation.decimals)).toEqual([
      18,
      18,
    ]);

    for (const asset of memeAssets) {
      expect(asset.chainId).toBe(BASE_CHAIN_ID);
      expect(asset.contractAddress).toMatch(evmAddressPattern);
      expect(asset.availability).toBe("informational");
      expect(asset.projectUrl?.startsWith("https://")).toBe(true);
      expect(asset.contractUrl).toContain("basescan.org/token/");
    }
  });

  test("uses chain and address, never display ticker, as contract identity", () => {
    const identities = investAssets.map(
      (asset) => `${asset.chainId}:${asset.contractAddress.toLowerCase()}`,
    );

    expect(new Set(identities).size).toBe(identities.length);
    expect(investAssets.map((asset) => asset.id)).toEqual([
      "nvdac",
      "metac",
      "aaplc",
      "googlc",
      "cbbtc",
      "cbxrp",
      "cbdoge",
      "cbltc",
      "cbada",
      "degen",
      "toshi",
    ]);
  });

  test("presents familiar identity separately from the exact Base token", () => {
    expect(getAssetPresentation(cryptoAssets[0])).toEqual({
      primaryName: "Bitcoin",
      primarySymbol: "BTC",
      tokenLabel: "cbBTC token representation",
      networkLabel: "Base 8453",
      priceUnitLabel: "Per cbBTC token",
    });
    expect(getAssetPresentation(memeAssets[0]).tokenLabel).toBe("DEGEN token");
  });

  test("builds trending ids and initials from the onchain symbol", () => {
    expect(initialsFromSymbol("DEGEN")).toBe("DE");
    expect(initialsFromSymbol("$HIGHER")).toBe("HI");
    expect(trendingTokenId("0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed")).toBe(
      "base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    );
    expect(findInvestAssetByAddress("0x4ed4e862860bed51a9570b96d89af5e1b0efefed")?.id).toBe(
      "degen",
    );
  });

  test("truncates only presentation text without changing the registry value", () => {
    const address = stockAssets[0].contractAddress;
    expect(shortenContractAddress(address)).toBe("0xb20000…108C");
    expect(address).toBe("0xb20000000000000000000078ee7ce2fE4908108C");
  });
});
