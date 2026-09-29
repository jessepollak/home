import { describe, expect, test } from "bun:test";
import stocks from "./invest-sources/base-stocks.json";
import wrapped from "./invest-sources/coinbase-wrapped.json";
import { TOKENIZED_EQUITY_ORACLE_REGISTRY, cryptoAssets, findInvestAssetByAddress, investAssets, memeAssets, stockAssets } from "./invest-assets";

const identity = (value: string) => value.toLowerCase();

describe("invest asset registry", () => {
  test("matches the dated Base roster and feed directory for every stock", () => {
    expect(stocks).toMatchObject({ schemaVersion: 1, chainId: 8453, verifiedAt: "2026-09-28", verificationBlock: { number: 51886274, timestamp: "2026-09-28T02:18:15Z" } });
    expect(identity(TOKENIZED_EQUITY_ORACLE_REGISTRY)).toBe(identity(stocks.oracleRegistry));
    expect(stockAssets).toHaveLength(stocks.stocks.length);
    for (const row of stocks.stocks) {
      const asset = stockAssets.find(({ representation }) => representation.tokenSymbol === row.tokenSymbol);
      expect(asset).toMatchObject({ listing: "listed", category: "stock", chainId: stocks.chainId, contractAddress: row.contract, displayName: row.displayName, representation: { tokenSymbol: row.tokenSymbol, decimals: row.decimals, issuer: "Coinbase" }, valuation: { kind: "tokenized-equity-feed", feedProxy: row.feed.proxy, feedDecimals: row.feed.decimals, heartbeatSeconds: row.feed.heartbeatSeconds } });
      expect(row.feed.description).toBe(`Coinbase ${row.tokenSymbol.slice(0, -1)}`);
    }
    expect(new Set(stockAssets.map(({ valuation }) => valuation.feedProxy.toLowerCase())).size).toBe(stockAssets.length);
  });

  test("matches the dated Coinbase issuer roster for every Base wrapped asset", () => {
    expect(wrapped).toMatchObject({ schemaVersion: 1, chainId: 8453, verifiedAt: stocks.verifiedAt, verificationBlock: stocks.verificationBlock, source: "https://www.coinbase.com/cbbtc" });
    expect(cryptoAssets).toHaveLength(wrapped.assets.length);
    for (const row of wrapped.assets) {
      const asset = cryptoAssets.find(({ representation }) => representation.tokenSymbol === row.tokenSymbol);
      expect(asset).toMatchObject({ category: "crypto", listing: "listed", chainId: wrapped.chainId, contractAddress: row.contract, representation: { tokenSymbol: row.tokenSymbol, decimals: row.decimals, issuer: "Coinbase" }, projectUrl: wrapped.source });
      expect(asset?.representation.relationship).toContain("Home does not provide redemption");
      expect(asset).not.toHaveProperty("valuation");
    }
    expect(wrapped.assets.find(({ tokenSymbol }) => tokenSymbol === "cbZEC")?.sourceLabel).toBe("Wrapped ZEC");
    expect(wrapped.excluded).toEqual([{ tokenSymbol: "cbETH", reason: "variable-representation" }, { tokenSymbol: "cbSOL", reason: "no-base-contract" }]);
    for (const excluded of wrapped.excluded) expect(cryptoAssets.some(({ representation }) => representation.tokenSymbol === excluded.tokenSymbol)).toBe(false);
    for (const tokenSymbol of ["cbHYPE", "cbZEC"]) {
      const asset = cryptoAssets.find(({ representation }) => representation.tokenSymbol === tokenSymbol)!;
      expect(asset.contractAddress.toLowerCase()).toMatch(/^0xb200/);
      expect(asset.category).toBe("crypto");
      expect(asset).not.toHaveProperty("valuation");
    }
  });

  test("uses chain and address as unique holdings identity, including removed entries", () => {
    const identities = investAssets.map((asset) => `${asset.chainId}:${identity(asset.contractAddress)}`);
    expect(new Set(identities).size).toBe(identities.length);
    for (const asset of investAssets) expect(findInvestAssetByAddress(asset.contractAddress.toUpperCase())).toMatchObject({ id: asset.id });
    expect(memeAssets.map((asset) => asset.representation.decimals)).toEqual([18, 18]);
  });
});
