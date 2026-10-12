import { describe, expect, test } from "bun:test";
import stocks from "./invest-sources/base-stocks.json";
import wrapped from "./invest-sources/coinbase-wrapped.json";
import { TOKENIZED_EQUITY_ORACLE_REGISTRY, cryptoAssets, findInvestAssetByAddress, investAssets, stockAssets } from "./invest-assets";

const identity = (value: string) => value.toLowerCase();

describe("invest asset registry", () => {
  test("matches the dated Base roster and feed directory for every stock", () => {
    expect(identity(TOKENIZED_EQUITY_ORACLE_REGISTRY)).toBe(identity(stocks.oracleRegistry));
    expect(stockAssets).toHaveLength(stocks.stocks.length);
    for (const row of stocks.stocks) {
      const asset = stockAssets.find(({ representation }) => representation.tokenSymbol === row.tokenSymbol);
      expect(asset).toMatchObject({ chainId: stocks.chainId, contractAddress: row.contract, displayName: row.displayName, representation: { tokenSymbol: row.tokenSymbol, decimals: row.decimals }, valuation: { feedProxy: row.feed.proxy, feedDecimals: row.feed.decimals, heartbeatSeconds: row.feed.heartbeatSeconds } });
    }
    expect(new Set(stockAssets.map(({ valuation }) => valuation.feedProxy.toLowerCase())).size).toBe(stockAssets.length);
  });

  test("matches the dated Coinbase issuer roster for every Base wrapped asset", () => {
    expect(cryptoAssets).toHaveLength(wrapped.assets.length);
    for (const row of wrapped.assets) {
      const asset = cryptoAssets.find(({ representation }) => representation.tokenSymbol === row.tokenSymbol);
      expect(asset).toMatchObject({ chainId: wrapped.chainId, contractAddress: row.contract, representation: { tokenSymbol: row.tokenSymbol, decimals: row.decimals }, projectUrl: wrapped.source });
    }
    for (const excluded of wrapped.excluded) expect(cryptoAssets.some(({ representation }) => representation.tokenSymbol === excluded.tokenSymbol)).toBe(false);
  });

  test("uses chain and address as unique holdings identity, including removed entries", () => {
    const identities = investAssets.map((asset) => `${asset.chainId}:${identity(asset.contractAddress)}`);
    expect(new Set(identities).size).toBe(identities.length);
    for (const asset of investAssets) expect(findInvestAssetByAddress(asset.contractAddress.toUpperCase())).toMatchObject({ id: asset.id });
  });
});
