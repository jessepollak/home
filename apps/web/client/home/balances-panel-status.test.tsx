import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import { BalancesPage } from "./balances-panel";

afterEach(cleanup);

describe("Balances subtotal status", () => {
  test("partial subtotal shows known amount without animation and status-line Retry works", () => {
    let retries = 0;
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
      cbbtc: { balance: unavailableBalance },
    } });
    const view = render(<BalancesPage
      active assetBalances={presentBalances({ status: "ready", snapshot, error: null })}
      showSmallBalances={false} revealSmallBalances={false} onRevealSmallBalancesChange={() => {}}
      isChecking={false} revealedCount={10} onRevealMore={() => {}}
      onRetryBalances={() => { retries += 1; }}
    />);
    const subtotal = view.container.querySelector<HTMLElement>("[data-subtotal-status='partial']");
    expect(subtotal?.textContent).toContain("Partial balance $50.00");
    expect(subtotal?.querySelector("[data-animated]")?.getAttribute("data-animated")).toBe("false");
    expect(view.container.querySelector("p[data-total-status='partial']")?.textContent).toBe("Partial balance");
    fireEvent.click(view.getByRole("button", { name: "Retry balances" }));
    expect(retries).toBe(1);
  });

  test("unavailable subtotals display a dash, not a zero", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: unavailableBalance },
      eth: { balance: unavailableBalance },
    }, coverage: { catalog: "unavailable" } });
    const view = render(<BalancesPage
      active assetBalances={presentBalances({ status: "ready", snapshot, error: null })}
      showSmallBalances={false} revealSmallBalances={false} onRevealSmallBalancesChange={() => {}}
      isChecking={false} revealedCount={10} onRevealMore={() => {}}
    />);
    const subtotals = view.container.querySelectorAll<HTMLElement>("[data-subtotal-status='unavailable']");
    expect(subtotals.length).toBe(2);
    for (const subtotal of subtotals) {
      expect(subtotal.textContent).toContain("—Unavailable");
      expect(subtotal.textContent).not.toContain("$0.00");
    }
    expect(view.queryByRole("button", { name: "Retry balances" })).toBeNull();
  });
});
