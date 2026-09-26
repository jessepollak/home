import { describe, expect, test } from "bun:test";
import { investAssets } from "@/config/invest-assets";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { buyRouteForToken } from "./assets";

const bitcoin = VERIFIED_MORPHO_MARKETS.find((market) => market.collateralToken.symbol === "cbBTC")!;
const xrp = VERIFIED_MORPHO_MARKETS.find((market) => market.collateralToken.symbol === "cbXRP")!;
const investBitcoin = investAssets.find((asset) => asset.id === "cbbtc")!;

describe("Buy route by token identity", () => {
  test("routes cbBTC with checksum and lowercase addresses", () => {
    expect(buyRouteForToken({ chainId: 8453, address: bitcoin.collateralToken.address })).toBe("cbbtc");
    expect(buyRouteForToken({ chainId: 8453, address: bitcoin.collateralToken.address.toLowerCase() })).toBe("cbbtc");
    expect(buyRouteForToken({ chainId: 8453, address: bitcoin.collateralToken.address.toUpperCase() })).toBe("cbbtc");
  });
  test("does not route unsupported, mislabeled, or wrong-chain tokens", () => {
    expect(buyRouteForToken({ chainId: 8453, address: xrp.collateralToken.address })).toBeNull();
    const mislabeled = { chainId: 8453, address: "0x0000000000000000000000000000000000000001", symbol: "cbBTC" };
    expect(buyRouteForToken(mislabeled)).toBeNull();
    expect(buyRouteForToken({ chainId: 1, address: investBitcoin.contractAddress })).toBeNull();
  });
});
