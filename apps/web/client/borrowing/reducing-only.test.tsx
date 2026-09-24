import "@/client/account/dom-test-harness";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as configuredBorrow from "@/shared/borrowing/config";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";

const originalBorrowConfig = { ...configuredBorrow };
const reducedMarket = originalBorrowConfig.BORROW_MARKETS[2]!;
const markets = originalBorrowConfig.BORROW_MARKETS.map((market) => market.marketId === reducedMarket.marketId
  ? { ...market, availability: "reducing-only" as const }
  : market);
mock.module("@/shared/borrowing/config", () => ({
  ...originalBorrowConfig,
  BORROW_MARKETS: markets,
  getBorrowMarketRef: (marketId: string) => markets.find((market) => market.marketId.toLowerCase() === marketId.toLowerCase()) ?? null,
}));

afterAll(() => {
  mock.module("@/shared/borrowing/config", () => originalBorrowConfig);
});

const { cleanup, render, within } = await import("@testing-library/react");
afterEach(() => cleanup());
const { BorrowExperience } = await import("./borrowing-experience");

const session = {
  user: { subject: "borrow-reducing-only" },
  smartAccount: { address: "0x1111111111111111111111111111111111111111" as const, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};

describe("operator-restricted Borrow market", () => {
  test("keeps Repay and Add collateral available for a reducing-only non-BTC position", async () => {
    const response = borrowOverviewBody();
    const opportunity = response.opportunities.find((entry) => entry.market.id === reducedMarket.marketId);
    if (!opportunity || opportunity.availability.status !== "available") throw new Error("Expected the verified cbETH opportunity.");
    opportunity.availability.mode = "reducing-only";
    opportunity.availability.snapshot.eligibility = {
      mode: "reducing-only", newRisk: false, reason: "New borrowing is paused. You can still repay or add collateral.",
    };
    render(<BorrowExperience session={session} fetchAccountResource={async () => response} />);
    const body = within(document.body);
    const heading = await body.findByRole("heading", { name: "Staked ETH" });
    expect(body.getAllByTestId("borrow-market-card")).toHaveLength(5);
    const card = within(heading.closest("[data-testid=borrow-market-card]") as HTMLElement);
    expect((card.getByRole("button", { name: "Borrow more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole("button", { name: "Withdraw collateral from Staked ETH position" }) as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole("button", { name: "Repay" }) as HTMLButtonElement).disabled).toBe(false);
    expect((card.getByRole("button", { name: "Add collateral" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
