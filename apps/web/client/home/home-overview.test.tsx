import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MoneyBreakdownItem } from "@/shared/balances/present";
import { HomeOverview } from "./home-overview";
import { HomeMoneySummary } from "./home-overview";
import { ProductOfferingProvider } from "./product-offering";
import type { HomeMoneySummary as Summary } from "@/shared/balances/present";
import { deploymentProductSettings, resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";

const initial: MoneyBreakdownItem[] = [
  { id: "cash", label: "Cash", value: "$1.00", weight: 100 },
  { id: "investments", label: "Investments", value: "$9.00", weight: 900 },
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

function legendButton(id: MoneyBreakdownItem["id"]) {
  const list = within(document.body).getByRole("list", { name: "Balance allocation" });
  return within(list.querySelector<HTMLElement>(`[data-breakdown-item="${id}"]`)!).getByRole("button");
}

function selected(id: MoneyBreakdownItem["id"]) {
  expect(legendButton(id).getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(`[data-balance-segment="${id}"]`)?.getAttribute("data-selected")).toBe("true");
}

afterEach(cleanup);

describe("product offerings on the money summary", () => {
  const summary: Summary = { cash: { status: "complete", value: "$1.00" }, investments: { status: "complete", value: "$0.00", assetCount: 0, ownedCount: 0 }, borrow: { kind: "none", hasCollateral: false } };
  const renderSummary = (mode: "deployment" | "unavailable", value: Summary = summary, offerRate: string | null = null, onOpenBorrow = () => {}) => render(
    <ProductOfferingProvider value={resolveProductOffering({ kind: mode })}>
      <HomeMoneySummary summary={value} isLoading={false} cashRate={null} borrowOfferRate={offerRate} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow }} />
    </ProductOfferingProvider>,
  );
  test("offered Invest and Borrow show their discovery rows", () => {
    const view = renderSummary("deployment");
    expect(view.getByRole("button", { description: "Open Invest" })).toBeTruthy();
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
  });
  const withOffering = (offering: ProductOffering, value: Summary = summary, offerRate: string | null = null) => (
    <ProductOfferingProvider value={offering}>
      <HomeMoneySummary summary={value} isLoading={false} cashRate={null} borrowOfferRate={offerRate} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>
  );
  const catalog = { vaults: [], markets: [{ id: `0x${"ab".repeat(32)}`, mode: "enabled" as const }] };
  const catalogSettings = deploymentProductSettings(catalog);
  const offeredMarket = resolveProductOffering({ kind: "saved", value: catalogSettings }, catalog);
  const reducingOnlyMarkets = resolveProductOffering({
    kind: "saved",
    value: { ...catalogSettings, markets: { [catalog.markets[0].id]: "reducing-only" as const } },
  }, catalog);
  test("Borrow with every market reducing-only hides the discovery row but keeps holders", () => {
    const view = render(withOffering(reducingOnlyMarkets));
    expect(view.queryByRole("button", { description: "Open Borrow" })).toBeNull();
    view.rerender(withOffering(offeredMarket));
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
    view.rerender(withOffering(reducingOnlyMarkets, { ...summary, borrow: { kind: "position", status: "complete", value: "$2.00", rate: null, debts: [] } }));
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
    view.rerender(withOffering(reducingOnlyMarkets, { ...summary, borrow: { kind: "none", hasCollateral: true } }, "3.15% APR"));
    const collateralRow = view.getByRole("button", { description: "Open Borrow" });
    expect(collateralRow.textContent).toContain("Collateral");
    expect(collateralRow.textContent).toContain("Manage in Borrow");
    expect(collateralRow.textContent).not.toContain("Borrow Cash");
    expect(collateralRow.textContent).not.toContain("3.15% APR");
    view.rerender(withOffering(reducingOnlyMarkets, { ...summary, borrow: { kind: "unavailable" } }));
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
  });
  test("offered Borrow still shows the borrowing rate with collateral and no debt", () => {
    const view = renderSummary("deployment", { ...summary, borrow: { kind: "none", hasCollateral: true } }, "3.15% APR");
    expect(view.getByRole("button", { description: "Open Borrow" }).textContent).toContain("Borrow Cash");
    expect(view.getByRole("button", { description: "Open Borrow" }).textContent).toContain("Borrow at 3.15% APR");
  });
  test("exit-only removes discovery without removing holders' Investments and Borrow exits", () => {
    const view = renderSummary("unavailable");
    expect(view.queryByRole("button", { description: "Open Invest" })).toBeNull();
    expect(view.queryByRole("button", { description: "Open Borrow" })).toBeNull();
    view.rerender(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeMoneySummary summary={{ ...summary, investments: { ...summary.investments, ownedCount: 1, assetCount: 1, value: "$5.00" }, borrow: { kind: "position", status: "complete", value: "$2.00", rate: null, debts: [] } }} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>);
    expect(view.getByRole("button", { description: "Open Investments" })).toBeTruthy();
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
  });
  test("exit-only keeps collateral-only Borrow reachable as a management row without a borrow rate", () => {
    let opened = 0;
    const view = renderSummary("unavailable", { ...summary, borrow: { kind: "none", hasCollateral: true } }, "3.15% APR", () => { opened++; });
    const row = view.getByRole("button", { description: "Open Borrow" });
    expect(row.textContent).toContain("Collateral");
    expect(row.textContent).toContain("Manage in Borrow");
    expect(row.textContent).not.toContain("Borrow Cash");
    expect(row.textContent).not.toContain("3.15% APR");
    expect(row.querySelector('[data-slot="item-actions"] svg')).toBeTruthy();
    fireEvent.click(row);
    expect(opened).toBe(1);
    view.rerender(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeMoneySummary summary={summary} isLoading={false} cashRate={null} borrowOfferRate="3.15% APR" destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>);
    expect(view.queryByRole("button", { description: "Open Borrow" })).toBeNull();
  });
  test("exit-only keeps exits visible when balances are unavailable or partial, but hides known empty rows", () => {
    const view = renderSummary("unavailable", { ...summary, investments: { status: "unavailable", value: null, ownedCount: 0, assetCount: 0 }, borrow: { kind: "unavailable" } });
    expect(view.getByRole("button", { description: "Open Investments" })).toBeTruthy();
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
    view.rerender(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeMoneySummary summary={{ ...summary, investments: { status: "partial", value: null, ownedCount: 0, assetCount: 0 } }} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>);
    expect(view.getByRole("button", { description: "Open Investments" })).toBeTruthy();
    expect(view.queryByRole("button", { description: "Open Borrow" })).toBeNull();
    view.rerender(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeMoneySummary summary={summary} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>);
    expect(view.queryByRole("button", { description: "Open Invest" })).toBeNull();
    expect(view.queryByRole("button", { description: "Open Investments" })).toBeNull();
    expect(view.queryByRole("button", { description: "Open Borrow" })).toBeNull();
  });
  test("exit-only keeps exits visible when no summary has loaded", () => {
    const view = render(<ProductOfferingProvider value={resolveProductOffering({ kind: "unavailable" })}>
      <HomeMoneySummary summary={null} isLoading={false} cashRate={null} borrowOfferRate={null} destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
    </ProductOfferingProvider>);
    expect(view.getByRole("button", { description: "Open Investments" })).toBeTruthy();
    expect(view.getByRole("button", { description: "Open Borrow" })).toBeTruthy();
  });
});

describe("Home balance allocation", () => {
  test("retains the selected category when values and proportions refresh", () => {
    const view = render(overview(initial, "account-a"));
    fireEvent.click(document.querySelector('[data-balance-segment="cash"]')!);
    selected("cash");
    view.rerender(overview([
      { id: "cash", label: "Cash", value: "$3.00", weight: 300 },
      { id: "investments", label: "Investments", value: "$7.00", weight: 700 },
    ], "account-a"));
    selected("cash");
    expect(legendButton("investments").getAttribute("aria-pressed")).toBe("false");
  });

  test("clears selection when the category disappears", () => {
    const view = render(overview(initial, "account-a"));
    fireEvent.click(legendButton("cash"));
    selected("cash");
    view.rerender(overview([initial[1]!], "account-a"));
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
      const main = view.container.querySelector("main")!;
      const money = view.container.querySelector<HTMLElement>("[data-sticky-fit]")!;
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
