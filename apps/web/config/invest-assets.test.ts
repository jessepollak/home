import { describe, expect, test } from "bun:test";
import {
  BASE_CHAIN_ID,
  cryptoAssets,
  investAssets,
  memeAssets,
} from "./invest-assets";

const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;

describe("invest asset registry", () => {
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
      "amznc",
      "msftc",
      "mstrc",
      "sndkc",
      "spcxc",
      "tslac",
      "cbbtc",
      "cbxrp",
      "cbdoge",
      "cbltc",
      "cbada",
      "degen",
      "toshi",
    ]);
  });


});
