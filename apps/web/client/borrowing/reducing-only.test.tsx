import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { borrowOverviewBody } from "@/tests/browser/fixtures/bodies";
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
});
