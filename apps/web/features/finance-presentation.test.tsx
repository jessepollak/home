import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvestExperience } from "./invest/invest-experience";
import { SavingsExperience } from "./savings/savings-experience";
import type { MorphoVaultsResult } from "@/server/morpho/types";

const vaultsFixture: MorphoVaultsResult = {
  version: "v1",
  chainId: 8453,
  asset: {
    address: "0x1111111111111111111111111111111111111111",
    symbol: "USDC",
    decimals: 6,
  },
  candidates: [
    {
      version: "v1",
      vaultAddress: "0x2222222222222222222222222222222222222222",
      name: "USDC Prime",
      symbol: "usdcP",
      listed: true,
      chainId: 8453,
      asset: {
        address: "0x1111111111111111111111111111111111111111",
        symbol: "USDC",
        decimals: 6,
      },
      curatorAddress: "0x3333333333333333333333333333333333333333",
      grossApy: 0.05,
      netApy: 0.045,
      feeRate: 0.005,
      totalAssetsRaw: "1250000000",
      liquidityRaw: "500000000",
      stateAsOf: "2026-09-07T20:00:00.000Z",
      blockNumber: "35123456",
      source: {
        provider: "Morpho GraphQL",
        endpoint: "https://api.morpho.org/graphql",
        query: "vaults",
        fetchedAt: "2026-09-07T20:30:00.000Z",
      },
    },
  ],
  source: {
    provider: "Morpho GraphQL",
    endpoint: "https://api.morpho.org/graphql",
    query: "vaults",
    fetchedAt: "2026-09-07T20:30:00.000Z",
  },
  stale: false,
};

describe("finance-first presentation", () => {
  test("leads Invest with a discovery hub and no invented prices, trades, or disclosures", () => {
    const markup = renderToStaticMarkup(<InvestExperience />);

    expect(markup).toContain('id="invest-title"');
    expect(markup).toContain("Invest");
    expect(markup).toContain("Browse on Base");
    expect(markup).toContain("Stocks");
    expect(markup).toContain("Crypto");
    expect(markup).toContain("Memes");
    expect(markup).toContain("NVIDIA");
    expect(markup).toContain("Bitcoin");
    expect(markup).toContain("Degen");
    expect(markup).toContain("See all");
    expect(markup).not.toContain("Cardano");
    expect(markup).not.toContain("Price unavailable");
    expect(markup).not.toContain(">0.00<");
    expect(markup).not.toContain("Stock contracts");
    expect(markup).not.toContain("Meme contracts");
    expect(markup).not.toContain("Wrapped token contracts");
    expect(markup).not.toContain("Available only in eligible jurisdictions");
    expect(markup).not.toContain("Stock access is unavailable");
    expect(markup).not.toContain("not an endorsement");
    expect(markup).not.toContain("Buy");
    expect(markup).not.toContain("Sell");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Approve");
    expect(markup).not.toContain("Sign transaction");
  });

  test("labels a crypto snapshot per wrapped token without implying native-asset parity", () => {
    const markup = renderToStaticMarkup(
      <InvestExperience
        cryptoMarket={{
          status: "ready",
          snapshots: [
            {
              assetId: "cbbtc",
              displayPrice: "$100,000 supplied",
              asOf: "2026-09-07T20:00:00.000Z",
              sourceLabel: "Crypto fixture",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Bitcoin");
    expect(markup).toContain("BTC");
    expect(markup).toContain("$100,000 supplied");
    expect(markup).not.toContain("1 cbBTC = 1 BTC");
    expect(markup).not.toContain("cbETH");
  });

  test("shows a supplied hub price without exposing source chrome on the shelf row", () => {
    const markup = renderToStaticMarkup(
      <InvestExperience stockMarket={{
        status: "ready",
        snapshots: [{
          assetId: "nvdac",
          displayPrice: "$231.708792875",
          asOf: "2026-09-07T20:00:00.000Z",
          sourceLabel: "Price fixture",
          sourceUrl: "https://prices.example.test/nvdac",
        }],
      }} />,
    );
    expect(markup).toContain("$231.71");
    expect(markup).not.toContain("$231.708792875");
    expect(markup).not.toContain('href="https://prices.example.test/nvdac"');
  });

  test("leads savings with an unavailable USDC position and leaves every vault unselected", () => {
    const markup = renderToStaticMarkup(
      <SavingsExperience initialData={vaultsFixture} />,
    );

    expect(markup.indexOf("USDC balance")).toBeLessThan(
      markup.indexOf("Vault candidates"),
    );
    expect(markup).toContain("Position unavailable until account verification.");
    expect(markup).toContain("Variable net APY");
    expect(markup).toContain("Fetched snapshot");
    expect(markup).toContain("4.50%");
    expect(markup).toContain("1,250 USDC");
    expect(markup).toContain("500 USDC");
    expect(markup).not.toContain("aria-pressed");
    expect(markup.match(/disabled=""/g)?.length).toBe(2);
  });
});
