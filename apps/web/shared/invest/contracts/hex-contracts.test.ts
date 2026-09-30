import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { parseDynamicInvestAsset } from "./discover";
import { isInvestSearchAddressQuery, parseInvestSearchResponse } from "./search";

const address = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const asset = {
  id: `base:${address.toLowerCase()}`, category: "meme", displayName: "Sample", displaySymbol: "SAMPLE", initials: "SA",
  chainId: 8453, contractAddress: address, availability: "informational", descriptor: "Sample asset", contractUrl: "https://example.com",
  representation: { tokenSymbol: "SAMPLE", decimals: 18 },
};

test("dynamic discover asset canonicalizes checksum and rejects invalid address", () => {
  expect(String(parseDynamicInvestAsset(asset)?.contractAddress)).toBe(address.toLowerCase());
  for (const bad of [address.replace("A", "a"), "0x1234", "0xzzzz"]) {
    expect(parseDynamicInvestAsset({ ...asset, contractAddress: bad })).toBeNull();
  }
});

test("search query detection accepts any case but response assets enforce checksum", () => {
  expect(isInvestSearchAddressQuery(address.toUpperCase().replace("0X", "0x"))).toBe(true);
  expect(isInvestSearchAddressQuery("0x1234")).toBe(false);
  const response = { version: 1, query: address, offset: 0, results: [{ kind: "dynamic", match: "contract", source: "indexed", asset }], snapshots: [], provider: "ok", coverage: "complete", nextOffset: null };
  expect(String(parseInvestSearchResponse(response)?.results[0]?.asset.contractAddress)).toBe(address.toLowerCase());
  expect(parseInvestSearchResponse({ ...response, results: [{ ...response.results[0], asset: { ...asset, contractAddress: address.replace("A", "a") } }] })).toBeNull();
});
