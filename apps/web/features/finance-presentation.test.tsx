import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
}));

import { renderToStaticMarkup } from "react-dom/server";
const { InvestExperience } = await import("./invest/invest-experience");
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
      stateAsOf: "2026-09-07T20:30:00.000Z",
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
    expect(markup).not.toContain("Browse on Base");
    expect(markup).toContain("Stocks");
    expect(markup).toContain("Crypto");
    expect(markup).toContain("Memes");
    expect(markup).toContain("NVIDIA");
    expect(markup).toContain("Amazon");
    expect(markup).toContain("Microsoft");
    expect(markup).toContain("Bitcoin");
    expect(markup).toContain("Memes");
    expect(markup).not.toContain("Degen");
    expect(markup).not.toContain("Toshi");
    expect(markup).toContain("See all");
    expect(markup).not.toContain("Cardano");
    expect(markup).not.toContain("Tesla");
    expect(markup).not.toContain("Strategy");
    expect(markup).not.toContain("SanDisk");
    expect(markup).not.toContain("SpaceX");
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

  test("presents Invest hub prices in the selected local currency", async () => {
    const { PresentationQuoteProvider } = await import(
      "./invest/presentation-quote"
    );
    const markup = renderToStaticMarkup(
      <PresentationQuoteProvider
        value={{
          valueCurrency: "IDR",
          quoteUnitsPerUsd: { atoms: "16425", scale: 0 },
        }}
      >
        <InvestExperience
          stockMarket={{
            status: "ready",
            snapshots: [{
              assetId: "nvdac",
              displayPrice: "$231.708792875",
              asOf: "2026-09-07T20:00:00.000Z",
              sourceLabel: "Price fixture",
            }],
          }}
        />
      </PresentationQuoteProvider>,
    );
    expect(markup).toContain("Rp 3,805,816.92");
    expect(markup).not.toContain("$231.71");
  });

  test("leads Save with a dollar hero, quiet vault cards, and no essay UI", () => {
    const markup = renderToStaticMarkup(
      <SavingsExperience
        initialData={vaultsFixture}
        now={() => Date.parse("2026-09-07T20:31:00.000Z")}
      />,
    );

    expect(markup).toContain("$0.00");
    expect(markup).toContain("Nothing saved yet");
    expect(markup).toContain("Available vault · USDC · 4.50% APY");
    expect(markup).toContain("Get started");
    expect(markup).toContain("Details");
    expect(markup).toContain("4.50%");
    expect(markup).toContain('role="radio"');
    expect(markup).toContain("Get started");
    expect(markup).not.toContain("Rate comparison");
    expect(markup).not.toContain("Vault candidates");
    expect(markup).not.toContain("Fetched snapshot");
    expect(markup).not.toContain("Variable net APY");
    expect(markup).not.toContain("Prepare an action");
    expect(markup).not.toContain("Morpho V1");
    expect(markup).not.toContain("Borrow USDC");
    expect(markup).not.toContain("1,250 USDC");
    expect(markup).not.toContain("Share base units");
    expect(markup).not.toContain("not an endorsement");
  });
});
