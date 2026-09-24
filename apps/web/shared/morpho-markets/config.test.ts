import { describe, expect, test } from "bun:test";
import { VERIFIED_MORPHO_MARKETS, getVerifiedMorphoMarket } from "./config";
import { computeMorphoMarketId } from "./market-id";

const loan = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const irm = "0x46415998764C29aB2a25CbeA6254146D50D22687";
const markets = [
  { id: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9", lltv: "860000000000000000", rank: 1 },
  { id: "0xd4a903dc6d949519060c7707f9604fdc9772c046e05c2e3a8fce0bd7196e4109", symbol: "cbXRP", address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af", decimals: 6, oracle: "0x031b2EFC8d70042Ac8d9f5c793c4149eC4b60fdE", lltv: "625000000000000000", rank: 2 },
  { id: "0x0ca10126f6c94cbd9cf0a48cc9516ae5e3dec5aa68303e6d988ee37c5149bf0d", symbol: "cbETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, oracle: "0x97FF9CbD7E77348b2B8FfBB883bF29452aD18295", lltv: "770000000000000000", rank: 3 },
  { id: "0x73527ddd796e6d4f48387adaae36f6f3d49d606d7f2a15eb0c931416a58875d8", symbol: "cbDOGE", address: "0xcbD06E5A2B0C65597161de254AA074E489dEb510", decimals: 8, oracle: "0xA9D36600Fb9eba7548857e61F836Ec951e3091B2", lltv: "625000000000000000", rank: 4 },
  { id: "0xd7520ad198b497b6eb75bc690268f4597630dbc12e305e9d4105843bab36e41d", symbol: "cbADA", address: "0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c", decimals: 6, oracle: "0x35D87a743D1F2f7CaFb42D855dC1c5Df857Ce45f", lltv: "625000000000000000", rank: 5 },
] as const;

describe("verified Morpho market registry", () => {
  test("matches the five independently verified market identities and recomputed IDs", () => {
    expect(VERIFIED_MORPHO_MARKETS).toHaveLength(markets.length);
    for (const expected of markets) {
      const market = getVerifiedMorphoMarket(expected.id.toUpperCase());
      expect(market).not.toBeNull();
      expect(market).toMatchObject({
        marketId: expected.id, chainId: 8453, morpho: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
        loanToken: { address: loan, symbol: "USDC", decimals: 6 },
        collateralToken: { symbol: expected.symbol, decimals: expected.decimals },
        oracle: expected.oracle, irm, rank: expected.rank, capabilities: { borrow: "enabled" },
      });
      expect(market!.collateralToken.address.toLowerCase()).toBe(expected.address.toLowerCase());
      expect(market!.lltvWad).toBe(BigInt(expected.lltv));
      expect(computeMorphoMarketId({
        loanToken: market!.loanToken.address, collateralToken: market!.collateralToken.address,
        oracle: market!.oracle, irm: market!.irm, lltv: market!.lltvWad,
      })).toBe(expected.id);
    }
    expect(new Set(VERIFIED_MORPHO_MARKETS.map((market) => market.marketId)).size).toBe(5);
    expect(new Set(VERIFIED_MORPHO_MARKETS.map((market) => market.rank)).size).toBe(5);
    expect(new Set(VERIFIED_MORPHO_MARKETS.map((market) => market.collateralToken.address.toLowerCase())).size).toBe(5);
    expect(getVerifiedMorphoMarket(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
