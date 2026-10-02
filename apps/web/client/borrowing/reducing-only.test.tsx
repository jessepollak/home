import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";
import type { BorrowOverviewResponse } from "@/shared/borrowing/contract";
import { VERIFIED_MORPHO_MARKETS } from "@/shared/morpho-markets/config";
import { sessionBody } from "@/tests/browser/fixtures/bodies";

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
afterEach(() => cleanup());
const { BorrowOverview } = await import("./borrow-overview");
const session = {
  user: sessionBody.user,
  smartAccount: { address: sessionBody.smartAccount.address as `0x${string}`, chainId: 8453 as const },
  accountProvider: "cdp-embedded" as const,
};

describe("operator-restricted Borrow market", () => {
  test("keeps Repay and Add collateral available for a reducing-only non-BTC position", async () => {
    const response = borrowOverviewBody();
    const opportunity = response.opportunities.find((entry) => entry.market.id === VERIFIED_MORPHO_MARKETS[2]!.marketId);
    if (!opportunity || opportunity.availability.status !== "available") throw new Error("Expected the verified cbETH opportunity.");
    opportunity.availability.mode = "reducing-only";
    opportunity.availability.snapshot.eligibility = {
      mode: "reducing-only", newRisk: false, reason: "New borrowing is paused. You can still repay or add collateral.",
    };
    render(<BorrowOverview session={session} overview={response}
      prepareMoneyAction={async () => { throw new Error("Not exercised"); }}
      executeMoneyAction={async () => { throw new Error("Not exercised"); }} />);
    const body = within(document.body);
    const row = body.getByRole("button", { description: "Manage Staked ETH loan" });
    expect(row.textContent).toContain("Paused");
    fireEvent.click(row);
    const sheet = within(await body.findByRole("dialog", { name: "Staked ETH" }));
    expect((sheet.getByRole("button", { name: "Borrow more" }) as HTMLButtonElement).disabled).toBe(true);
    expect((sheet.getByRole("button", { name: "Withdraw collateral from Staked ETH position" }) as HTMLButtonElement).disabled).toBe(true);
    expect((sheet.getByRole("button", { name: "Repay" }) as HTMLButtonElement).disabled).toBe(false);
    expect((sheet.getByRole("button", { name: "Add collateral" }) as HTMLButtonElement).disabled).toBe(false);
  });

  function exitOnlyOverview(openMarketId: string | null) {
    const response = borrowOverviewBody({ openMarketId });
    const opportunities: BorrowOverviewResponse["opportunities"] = response.opportunities.map((entry) => {
      if (entry.availability.status !== "available") throw new Error("Expected available opportunities.");
      return {
        market: entry.market,
        availability: {
          status: "available" as const,
          mode: "reducing-only" as const,
          reason: null,
          source: entry.availability.source,
          snapshot: { ...entry.availability.snapshot, eligibility: { mode: "reducing-only" as const, newRisk: false, reason: "New borrowing is paused. You can still repay or add collateral." } },
        },
      };
    });
    return { ...response, opportunities };
  }

  test("shows a paused state instead of the first-loan intro when every market is reducing-only", async () => {
    render(<BorrowOverview session={session} overview={exitOnlyOverview(null)} />);
    const body = within(document.body);
    expect(body.getByText("New borrowing is paused")).toBeTruthy();
    expect(body.queryByRole("heading", { name: "Borrow against your crypto" })).toBeNull();
    expect(body.queryByRole("button", { name: "See supported assets" })).toBeNull();
    expect(body.queryByRole("region", { name: "Assets you can borrow against" })).toBeNull();
  });

  test("keeps open loans and exits visible when every market is reducing-only", async () => {
    render(<BorrowOverview session={session} overview={exitOnlyOverview(VERIFIED_MORPHO_MARKETS[2].marketId)} />);
    const body = within(document.body);
    expect(body.getByText("New borrowing is paused")).toBeTruthy();
    expect(body.getByRole("region", { name: "Open loans" })).toBeTruthy();
    expect(body.getByRole("button", { description: "Manage Staked ETH loan" })).toBeTruthy();
    expect(body.queryByRole("region", { name: "Assets you can borrow against" })).toBeNull();
    expect(body.queryByRole("heading", { name: "Borrow against your crypto" })).toBeNull();
  });

  test("shows the paused state for a partial overview with no offered market", async () => {
    const response = exitOnlyOverview(null);
    response.discovery = { ...response.discovery, status: "partial", verifiedCount: response.opportunities.length - 1, reason: "One market could not be verified." };
    response.opportunities[0] = { market: response.opportunities[0].market, availability: { status: "unavailable" as const, mode: "reducing-only" as const, reason: "Unavailable", source: null } };
    render(<BorrowOverview session={session} overview={response} />);
    const body = within(document.body);
    expect(body.getByText("New borrowing is paused")).toBeTruthy();
    expect(body.getByText("Some loans couldn't be checked")).toBeTruthy();
    expect(body.queryByRole("region", { name: "Assets you can borrow against" })).toBeNull();
  });
});
