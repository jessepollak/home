import type { Page } from "@playwright/test";
import { BORROW_MARKETS } from "../../shared/borrowing/config";
import { BORROW_OVERVIEW_VERSION, type BorrowOverviewResponse } from "../../shared/borrowing/contract";
import { MARKET_PRICES_VERSION, type MarketPricesResponse } from "../../shared/invest/contracts/market-prices";
import { sessionBody } from "../../tests/browser/fixtures/bodies";

const marketUnavailable = "Current verified chain state is unavailable for this market.";

export const performanceMarketPrices = {
  version: MARKET_PRICES_VERSION,
  provider: "codex",
  fetchedAt: null,
  markets: { stock: { status: "unavailable" }, crypto: { status: "unavailable" }, meme: { status: "unavailable" } },
} satisfies MarketPricesResponse;

export const performanceBorrowOverview = {
  version: BORROW_OVERVIEW_VERSION,
  chainId: 8453,
  owner: {
    address: sessionBody.smartAccount.address as `0x${string}`,
    accountProvider: sessionBody.accountProvider as "cdp-embedded",
  },
  discovery: {
    status: "partial",
    sourceBlock: null,
    candidateCount: BORROW_MARKETS.length,
    verifiedCount: 0,
    reason: "One or more configured markets could not be verified. Missing values are unavailable, not zero.",
    fetchedAt: "2026-09-24T12:00:00.000Z",
  },
  opportunities: BORROW_MARKETS.map((market) => ({
    market: {
      id: market.marketId,
      morpho: market.morpho,
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
      oracle: market.oracle,
      irm: market.irm,
      lltvWad: market.lltvWad.toString(10),
      rank: market.rank,
    },
    availability: { status: "unavailable" as const, mode: market.availability, reason: marketUnavailable, source: null },
  })),
  positions: [],
} satisfies BorrowOverviewResponse;

export async function installPerformanceFixtures(page: Page) {
  await page.route("**/api/market-prices", (route) => route.fulfill({ json: performanceMarketPrices }));
  await page.route("**/api/borrow", (route) => route.fulfill({ json: performanceBorrowOverview }));
}
