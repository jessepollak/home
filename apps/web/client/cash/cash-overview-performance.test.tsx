import "@/client/account/dom-test-harness";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, walletHolding } from "@/shared/balances/fixtures";
import { CashOverview } from "./cash-overview";

afterEach(cleanup);
const now = () => Date.parse("2026-09-10T12:04:00.000Z");
const noop = () => undefined;
const props = { metadata: null, vaultStatus: "failed" as const, nowMs: now(), now, onOpenSavings: noop, onAddMoney: noop };

describe("Cash presentation work", () => {
  test("renders Cash without sorting or formatting unrelated investments", () => {
    const investments = Array.from({ length: 100 }, (_, index) => walletHolding({
      address: `0x${(index + 100).toString(16).padStart(40, "0")}`, name: `Investment ${index}`, symbol: `I${index}`, decimals: 18,
    }, "1000000000000000000", { status: "unpriced", reason: "price-unavailable" }));
    const snapshot = buildBalancesSnapshotFixture({
      registry: { usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") } },
      catalog: investments,
    });
    for (const holding of investments) {
      Object.defineProperty(holding, "name", { get() { throw new Error("Cash must not prepare investment labels"); } });
      Object.defineProperty(holding, "symbol", { get() { throw new Error("Cash must not format investments"); } });
    }
    const view = render(<CashOverview {...props} snapshot={snapshot} />);
    expect(within(view.getByLabelText("Cash balance")).getByRole("img", { name: "$12.34" })).toBeTruthy();
    view.rerender(<CashOverview {...props} snapshot={snapshot} pendingCashout={{ state: "indeterminate" }} />);
    expect(view.getByLabelText("Cash balance").querySelector("[data-pending-cash-out]")?.textContent).toContain("—");
  });

  test("clears the previous owner's cash on replacement, failure and loading", () => {
    const funded = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
    } });
    const view = render(<CashOverview {...props} snapshot={funded} />);
    expect(within(view.getByLabelText("Cash balance")).getByRole("img", { name: "$12.34" })).toBeTruthy();
    view.rerender(<CashOverview {...props} snapshot={funded} balanceStatus="failed" />);
    expect(view.getByLabelText("Balance unavailable")).toBeTruthy();
    expect(view.queryAllByRole("img", { name: "$12.34" })).toHaveLength(0);
    const next = buildBalancesSnapshotFixture({ owner: "0x2222222222222222222222222222222222222222" });
    view.rerender(<CashOverview {...props} snapshot={next} />);
    expect(view.queryAllByRole("img", { name: "$12.34" })).toHaveLength(0);
    view.rerender(<CashOverview {...props} snapshot={null} balanceStatus="loading" />);
    expect(view.getByLabelText("Cash balance").getAttribute("aria-busy")).toBe("true");
  });
});
