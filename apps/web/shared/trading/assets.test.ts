import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { investAssets, stockAssets } from "@/config/invest-assets";
import { BASE_USDC } from "@/shared/assets/base";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { buyRouteForToken } from "./assets";

describe("Buy route by token identity", () => {
  test.each([...VERIFIED_MORPHO_MARKETS])("routes $collateralToken.symbol by exact Base contract", (market) => {
    const address = market.collateralToken.address;
    const route = investAssets.find((asset) => asset.contractAddress.toLowerCase() === address.toLowerCase())?.id ?? `base:${address.toLowerCase()}`;
    for (const variant of [address, address.toLowerCase(), getAddress(address)]) {
      expect(buyRouteForToken({ chainId: market.chainId, address: variant })).toBe(route);
    }
  });
  test("rejects other chains, USDC, stocks, and malformed addresses", () => {
    expect(buyRouteForToken({ chainId: 1, address: VERIFIED_MORPHO_MARKETS[0]!.collateralToken.address })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: BASE_USDC.address })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: stockAssets[0]!.contractAddress })).toBeNull();
    expect(buyRouteForToken({ chainId: 8453, address: "0xnot-a-contract" })).toBeNull();
  });
});

test("buy route rejects invalid checksum but accepts its checksummed spelling", () => {
  const address = getAddress("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
  expect(buyRouteForToken({ chainId: 8453, address })).toBe("cbbtc");
  expect(buyRouteForToken({ chainId: 8453, address: address.replace("B", "b") })).toBeNull();
});
