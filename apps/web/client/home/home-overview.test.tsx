import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MoneyBreakdownItem } from "@/shared/balances/present";
import { borrowPosition, buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance } from "@/shared/balances/fixtures";
import { presentBalances } from "@/shared/balances/present";
import type { BalancesSnapshot } from "@/shared/balances/types";
import { HomeOverview } from "./home-overview";
import { MountedShellPanel } from "./panel-shared";

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}


const initial: MoneyBreakdownItem[] = [
  { id: "cash", label: "Cash", status: "complete", value: "$1.00", weight: 100 },
  { id: "investments", label: "Investments", status: "complete", value: "$9.00", weight: 900 },
];

function overview(items: MoneyBreakdownItem[], accountKey: string | null, activity: ReactNode = null) {
  return (
    <HomeOverview
      assetBalances={{
        status: "ready",
        displayTotal: "$10.00",
        totalStatus: "complete",
        breakdown: items,
        summary: null,
      }}
      accountKey={accountKey}
      actions={null}
      activity={activity}
      cashRate={null}
      borrowOfferRate={null}
      destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
    />
  );
}
function snapshotOverview(snapshot: BalancesSnapshot, onRetryBalances?: () => void, accountKey = "account-a") {
  return (
    <HomeOverview
      assetBalances={presentBalances({ status: "ready", snapshot, error: null })}
      accountKey={accountKey} actions={null} activity={null} cashRate={null} borrowOfferRate={null}
      destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
      onRetryBalances={onRetryBalances}
    />
  );
}


function legendButton(id: MoneyBreakdownItem["id"]) {
  const list = within(document.body).getByRole("list", { name: "Balance allocation" });
  return within(requiredElement<HTMLElement>(list, `[data-breakdown-item="${id}"]`)).getByRole("button");
}

function selected(id: MoneyBreakdownItem["id"]) {
  expect(legendButton(id).getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(`[data-balance-segment="${id}"]`)?.getAttribute("data-selected")).toBe("true");
}

afterEach(cleanup);

describe("Home figure status", () => {
  test("partial hero describes its still exact amount and partial summary ticker stops animating", () => {
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      eth: { balance: ready("1000000000000000000"), value: priced("USD", "5000") },
      cbbtc: { balance: unavailableBalance },
    } });
    const view = render(snapshotOverview(snapshot));
    const figure = requiredElement<HTMLElement>(view.container, "[data-total-status='partial']");
    expect(figure.textContent).toContain("$51.00");
    expect(view.getByRole("img", { name: "$51.00", description: "Total balance Partial balance" })).toBe(figure);
    expect(figure.querySelector("[data-animated]")?.getAttribute("data-animated")).toBe("false");
    const investment = view.getByRole("button", { description: "Open Investments" });
    expect(investment.textContent).toContain("Some quantities unavailable");
    expect(investment.querySelector("[data-animated]")?.getAttribute("data-animated")).toBe("false");
    const legend = requiredElement<HTMLElement>(view.container, "[data-breakdown-item='investments']");
    expect(legend.dataset.breakdownStatus).toBe("partial");
    expect(legend.querySelector("[data-animated]")?.getAttribute("data-animated")).toBe("false");
  });

  test("keeps Total balance visible and explains partial data with a tappable status and recovery", () => {
    const complete = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
    } });
    const partial = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      cbbtc: { balance: unavailableBalance },
    } });
    const unavailable = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
    }, borrow: { coverage: "complete", positions: [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "5000"),
      debtBaseUnits: "30010000", debtValue: { status: "unavailable" },
    })] } });
    let retries = 0;
    const view = render(snapshotOverview(complete, () => { retries += 1; }));
    expect(view.container.querySelector("[data-total-status]")).toBeNull();
    expect(view.getByText("Total balance")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Partial balance" })).toBeNull();
    view.rerender(snapshotOverview(partial, () => { retries += 1; }));
    const line = view.container.querySelector("#home-total-status");
    expect(line?.textContent).toBe("Partial balance");
    expect(view.getByText("Total balance")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    expect(view.getByText("Some quantities unavailable")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry balances" }));
    expect(retries).toBe(1);
    expect(view.container.querySelector("[data-total-status='partial']")?.getAttribute("aria-describedby"))
      .toBe(`home-total-label ${line?.id}`);
    view.rerender(snapshotOverview(unavailable));
    expect(view.container.querySelector("[data-total-status='unavailable']")?.textContent).toContain("—");
    expect(view.getByText("Total balance")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Partial balance" })).toBeNull();
  });

  test("unmounts open partial details when retained Home becomes inactive and returns closed", async () => {
    const partial = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      cbbtc: { balance: unavailableBalance },
    } });
    let retries = 0;
    const panel = (active: boolean) => (
      <MountedShellPanel active={active}>
        {snapshotOverview(partial, () => { retries += 1; })}
      </MountedShellPanel>
    );
    const view = render(panel(true));
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const popup = await view.findByRole("dialog", { name: "Partial balance details" });
    const retry = within(popup).getByRole("button", { name: "Retry balances" });
    act(() => retry.focus());
    expect(document.activeElement).toBe(retry);
    view.rerender(panel(false));
    await waitFor(() => expect(popup.isConnected).toBe(false));
    expect(view.queryByRole("dialog", { name: "Partial balance details", hidden: true })).toBeNull();
    expect(view.queryByRole("button", { name: "Retry balances" })).toBeNull();
    expect(document.activeElement?.closest("[hidden], [inert], [aria-hidden='true']")).toBeNull();
    expect(retries).toBe(0);
    view.rerender(panel(true));
    expect(view.getByRole("button", { name: "Partial balance" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("dialog", { name: "Partial balance details", hidden: true })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const reopened = await view.findByRole("dialog", { name: "Partial balance details" });
    expect(reopened).not.toBe(popup);
    fireEvent.click(within(reopened).getByRole("button", { name: "Retry balances" }));
    expect(retries).toBe(1);
  });

  test("resets partial details across account A to B to A without leaking the previous reasons", async () => {
    const accountA = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      cbbtc: { balance: unavailableBalance },
    } });
    const accountB = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("2000000"), value: priced("USD", "200"), cashValue: pricedCash("USD", "200") },
      eth: { balance: ready("1000000000000000000"), value: { status: "unpriced", reason: "price-stale" } },
    } });
    const view = render(snapshotOverview(accountA, undefined, "account-a"));
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const first = await view.findByRole("dialog", { name: "Partial balance details" });
    expect(within(first).getByText("Some quantities unavailable")).toBeTruthy();
    view.rerender(snapshotOverview(accountB, undefined, "account-b"));
    await waitFor(() => expect(first.isConnected).toBe(false));
    expect(view.getByRole("button", { name: "Partial balance" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const second = await view.findByRole("dialog", { name: "Partial balance details" });
    expect(within(second).getByText("Price delayed")).toBeTruthy();
    expect(within(second).queryByText("Some quantities unavailable")).toBeNull();
    view.rerender(snapshotOverview(accountA, undefined, "account-a"));
    await waitFor(() => expect(second.isConnected).toBe(false));
    expect(view.getByRole("button", { name: "Partial balance" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const returned = await view.findByRole("dialog", { name: "Partial balance details" });
    expect(within(returned).getByText("Some quantities unavailable")).toBeTruthy();
    expect(within(returned).queryByText("Price delayed")).toBeNull();
  });

  test("removes open partial details when the same account becomes complete and starts a later partial read closed", async () => {
    const partial = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
      cbbtc: { balance: unavailableBalance },
    } });
    const view = render(snapshotOverview(partial, () => {}));
    fireEvent.click(view.getByRole("button", { name: "Partial balance" }));
    const popup = await view.findByRole("dialog", { name: "Partial balance details" });
    view.rerender(snapshotOverview(buildBalancesSnapshotFixture(), () => {}));
    await waitFor(() => expect(popup.isConnected).toBe(false));
    expect(view.queryByRole("button", { name: "Partial balance" })).toBeNull();
    expect(view.queryByRole("button", { name: "Retry balances" })).toBeNull();
    view.rerender(snapshotOverview(partial, () => {}));
    expect(view.getByRole("button", { name: "Partial balance" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("dialog", { name: "Partial balance details", hidden: true })).toBeNull();
  });

  test("background revalidation retains complete figures without partial chrome", () => {
    const snapshot = buildBalancesSnapshotFixture();
    const presentation = presentBalances({ status: "ready", snapshot, error: null, revalidating: true });
    const view = render(<HomeOverview assetBalances={presentation} accountKey="a" actions={null} activity={null} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />);
    expect(view.getByLabelText("Total balance").getAttribute("aria-busy")).toBe("true");
    expect(view.queryByRole("button", { name: "Partial balance" })).toBeNull();
    expect(view.getAllByRole("img", { name: "$0.00" }).length).toBeGreaterThan(0);
  });

  test("an unpriceable loan shows an unavailable hero with Retry and a disabled Borrow legend entry", () => {
    let retries = 0;
    const snapshot = buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("1000000"), value: priced("USD", "100"), cashValue: pricedCash("USD", "100") },
    }, borrow: { coverage: "complete", positions: [borrowPosition({
      collateralBaseUnits: "100000", collateralValue: priced("USD", "5000"),
      debtBaseUnits: "30010000", debtValue: { status: "unavailable" },
    })] } });
    const view = render(snapshotOverview(snapshot, () => { retries += 1; }));
    const figure = requiredElement<HTMLElement>(view.container, "[data-total-status='unavailable']");
    expect(figure.textContent).toContain("—Unavailable");
    expect(figure.textContent).not.toContain("$0.00");
    fireEvent.click(view.getByRole("button", { name: "Retry total balance" }));
    expect(retries).toBe(1);
    const borrow = requiredElement<HTMLElement>(view.container, "[data-breakdown-item='borrow']");
    expect(borrow.dataset.breakdownStatus).toBe("unavailable");
    expect(borrow.textContent).toContain("—Unavailable");
    const borrowControl = within(borrow).getByRole("button");
    expect(borrowControl.getAttribute("aria-disabled")).toBe("true");
    expect(borrowControl.getAttribute("tabindex")).toBe("-1");
    expect(view.container.querySelector("[data-balance-segment='borrow']")).toBeNull();
    expect(view.container.querySelector("[data-balance-axis]")).toBeNull();
  });

  test("matches the docs when a refresh removes the focused control", () => {
    const view = render(overview(initial, "account-a"));
    legendButton("cash").focus();
    expect(document.activeElement).toBe(legendButton("cash"));

    view.rerender(overview([], "account-a"));
    expect(document.querySelector("[data-balance-breakdown]")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test("matches the docs when a refresh removes the focused Borrow entry", () => {
    const view = render(overview([...initial, { id: "borrow", label: "Borrow", status: "complete", value: "−$2.00", weight: 200 }], "account-a"));
    legendButton("borrow").focus();

    view.rerender(overview(initial, "account-a"));
    expect(document.querySelector("[data-breakdown-item='borrow']")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(legendButton("cash").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Home balance allocation", () => {
  test("retains the selected category when values and proportions refresh", () => {
    const view = render(overview(initial, "account-a"));
    fireEvent.click(requiredElement(document, '[data-balance-segment="cash"]'));
    selected("cash");
    view.rerender(overview([
      { id: "cash", label: "Cash", status: "complete", value: "$3.00", weight: 300 },
      { id: "investments", label: "Investments", status: "complete", value: "$7.00", weight: 700 },
    ], "account-a"));
    selected("cash");
    expect(legendButton("investments").getAttribute("aria-pressed")).toBe("false");
  });

  test("clears selection when the category disappears", () => {
    const view = render(overview(initial, "account-a"));
    fireEvent.click(legendButton("cash"));
    selected("cash");
    view.rerender(overview(initial.slice(1), "account-a"));
    expect(legendButton("investments").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-selected]")).toBeNull();
  });

  test("clears selection when the account changes", () => {
    const view = render(overview(initial, "account-a"));
    fireEvent.click(legendButton("investments"));
    selected("investments");
    view.rerender(overview(initial, "account-b"));
    expect(legendButton("investments").getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector("[data-selected]")).toBeNull();
  });

  test("keeps money and Activity mounted while tall money scrolls instead of sticking", () => {
    const OriginalObserver = globalThis.ResizeObserver;
    let measure = () => {};
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { measure = () => callback([], this); }
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    try {
      const view = render(<main data-app-main-authenticated>{overview(initial, "account-a", <section aria-label="Activity">Transactions</section>)}</main>);
      const activity = view.getByRole("region", { name: "Activity" });
      const main = requiredElement<HTMLElement>(view.container, "main");
      const money = requiredElement<HTMLElement>(view.container, "[data-sticky-fit]");
      let contentHeight = 520;
      Object.defineProperty(main, "clientHeight", { get: () => 600 });
      Object.defineProperty(money, "scrollHeight", { get: () => contentHeight });
      act(measure);
      expect(money.dataset.stickyFit).toBe("true");
      fireEvent.click(legendButton("cash"));
      contentHeight = 580;
      act(measure);
      expect(money.dataset.stickyFit).toBe("false");
      selected("cash");
      expect(view.getByRole("region", { name: "Activity" })).toBe(activity);
      expect(money.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(view.container).getByRole("heading", { name: "Your money" })).toBeTruthy();
    } finally {
      globalThis.ResizeObserver = OriginalObserver;
    }
  });
});
