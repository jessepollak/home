import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import {
  borrowPosition, buildBalancesSnapshotFixture, priced, pricedCash, ready, unavailableBalance,
  type BalancesFixtureOptions,
} from "@/shared/balances/fixtures";
import { presentHomeBalances, type HomeBalancesPresentation, type MoneyBreakdownItem } from "@/shared/balances/present";
import { MoneyMotionProvider } from "@/components/money-ticker";
import { HomeOverview } from "./home-overview";
import { HomeMoneySummary } from "./home-overview";
import { HomeHeaderStatus, homeBalancesStatus } from "./home-status";
import { ProductOfferingProvider } from "./product-offering";
import type { HomeMoneySummary as Summary } from "@/shared/balances/present";
import { deploymentProductSettings, resolveProductOffering, type ProductOffering } from "@/shared/operator-settings/products";

const initial: MoneyBreakdownItem[] = [
  { id: "cash", label: "Cash", value: "$1.00", weight: 100, status: "complete" },
  { id: "investments", label: "Investments", value: "$9.00", weight: 900, status: "complete" },
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
      { id: "cash", label: "Cash", value: "$3.00", weight: 300, status: "complete" },
      { id: "investments", label: "Investments", value: "$7.00", weight: 700, status: "complete" },
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
    const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
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
      const money = view.container.querySelector<HTMLElement>("[data-sticky-fit]")!;
      let contentHeight = 520;
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
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
      if (innerHeightDescriptor) Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
      globalThis.ResizeObserver = OriginalObserver;
    }
  });
});

const cash = { usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") } };

function presented(options: BalancesFixtureOptions): HomeBalancesPresentation {
  return presentHomeBalances({ status: "ready", snapshot: buildBalancesSnapshotFixture(options), error: null });
}

function statusOverview(assetBalances: HomeBalancesPresentation, onRetryBalances?: () => void) {
  const status = homeBalancesStatus(assetBalances);
  return render(
    <MoneyMotionProvider reducedMotion={false}>
      {status ? <HomeHeaderStatus status={status} onRetry={onRetryBalances ?? (() => {})} onOpenAccount={() => {}} /> : null}
      <HomeOverview
        assetBalances={assetBalances}
        accountKey="account-a"
        actions={null}
        activity={null}
        cashRate="4.20% APY"
        borrowOfferRate={null}
        destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }}
        onRetryBalances={onRetryBalances}
      />
    </MoneyMotionProvider>,
  );
}

function openStatus() {
  const button = document.querySelector<HTMLButtonElement>("[data-home-status]");
  if (!button) throw new Error("Home header status control not found");
  fireEvent.click(button);
  return within(document.body).getByRole("dialog", { name: "Status" });
}

describe("Home balance figure status", () => {
  test("keeps a partial total in the foreground, still, and described by its status", () => {
    statusOverview(presented({
      registry: { ...cash, eth: { balance: ready("1"), value: { status: "unpriced", reason: "price-stale" } } },
    }));
    const hero = within(document.body).getByLabelText("Total balance");
    const total = within(hero).getByRole("img", { name: "$12.34", description: "Partial balance" });
    expect(total.getAttribute("data-animated")).toBe("false");
    expect(hero.querySelector("[data-value-tone='muted']")).toBeNull();
    expect(within(hero).queryByRole("button", { name: "Partial balance" })).toBeNull();
    expect(document.querySelector("[data-home-total-status]")).toBeNull();
  });

  test("keeps a complete total still and shows no status control", () => {
    statusOverview(presented({ registry: cash }));
    const hero = within(document.body).getByLabelText("Total balance");
    expect(hero.querySelector("[data-total-status]")).toBeNull();
    expect(within(hero).getAllByRole("img", { name: "$12.34" })[0]?.getAttribute("data-animated")).toBe("false");
    expect(within(hero).queryByRole("button", { name: /balance/i })).toBeNull();
  });

  test("explains each missing part and retries from the status popover", () => {
    let retries = 0;
    statusOverview(presented({
      registry: { ...cash, eth: { balance: unavailableBalance } },
      borrow: { coverage: "partial", positions: [] },
    }), () => { retries += 1; });
    const detail = openStatus();
    expect(detail.textContent).toContain("Total counts only what Home could read and price.");
    expect(detail.textContent).toContain("Some balances couldn’t be read.");
    expect(detail.textContent).toContain("Home couldn’t check for a loan.");
    expect(detail.textContent).not.toContain("Some prices are delayed.");
    fireEvent.click(within(detail).getByRole("button", { name: "Retry" }));
    expect(retries).toBe(1);
    fireEvent.keyDown(detail, { key: "Escape" });
  });

  test.each(["settled", "rapid"] as const)("keeps the described amount mounted during a %s Activity hide→show with no hero status chrome", async (transition) => {
    const assetBalances = presented({
      registry: { ...cash, eth: { balance: ready("1"), value: { status: "unpriced", reason: "price-stale" } } },
    });
    const show = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <HomeOverview assetBalances={assetBalances} accountKey="account-a" actions={null} activity={null}
          cashRate={null} borrowOfferRate={null}
          destinations={{ onOpenCash: () => {}, onOpenInvestments: () => {}, onOpenBorrow: () => {} }} />
      </Activity>
    );
    const view = render(show("visible"));
    const total = within(view.getByLabelText("Total balance")).getByRole("img", { name: "$12.34", description: "Partial balance" });
    view.rerender(show("hidden"));
    if (transition === "settled") await act(async () => {});
    await act(async () => { view.rerender(show("visible")); });
    expect(within(document.body).queryByRole("dialog")).toBeNull();
    expect(within(document.body).queryByRole("button", { name: "Partial balance" })).toBeNull();
    expect(within(view.getByLabelText("Total balance")).getByRole("img", { name: "$12.34", description: "Partial balance" })).toBe(total);
  });

  test.each([
    { pendingCashout: { state: "escrow", baseUnits: "1000000", partial: false } as const, retry: true, copy: "A pending cash-out can’t be valued right now." },
    ...(["indeterminate", "unreadable", "loading"] as const).map((state) => ({
      pendingCashout: { state }, retry: false, copy: "A pending cash-out isn’t counted yet.",
    })),
  ])("offers balances Retry for unpriced escrow, not actions uncertainty ($pendingCashout)", ({ pendingCashout, retry, copy }) => {
    const snapshot = buildBalancesSnapshotFixture({ registry: cash });
    const usdc = snapshot.holdings.find(({ id }) => id === "usdc");
    if (!usdc) throw new Error("USDC fixture missing");
    delete usdc.unitValue;
    let retries = 0;
    statusOverview(presentHomeBalances({ status: "ready", snapshot, error: null }, { pendingCashout }), () => { retries += 1; });
    const detail = openStatus();
    expect(detail.textContent).toContain(copy);
    const retryButton = within(detail).queryByRole("button", { name: "Retry" });
    expect(retryButton !== null).toBe(retry);
    if (retryButton) {
      fireEvent.click(retryButton);
      expect(retries).toBe(1);
    }
  });

  test("explains unavailable holding valuations without claiming prices are delayed", () => {
    statusOverview(presented({
      registry: { ...cash, eth: { balance: ready("1"), value: { status: "unpriced", reason: "price-paused" } } },
    }), () => {});
    const detail = openStatus();
    expect(detail.textContent).toContain("Some holdings can’t be valued right now.");
    expect(detail.textContent).not.toContain("Some prices are delayed.");
    expect(within(detail).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test.each([
    { reasons: ["pending-cash-out"] as const, retry: false },
    { reasons: ["pending-cash-out", "unreadable"] as const, retry: true },
    { reasons: ["pending-cash-out-unpriced"] as const, retry: true },
    { reasons: ["value-unavailable"] as const, retry: true },
    { reasons: [] as const, retry: true },
  ])("offers Retry only for recoverable reasons ($reasons)", ({ reasons, retry }) => {
    statusOverview({
      ...presented({ registry: cash }),
      totalStatus: "partial",
      statusLabel: "Partial balance",
      statusReasons: [...reasons],
    }, () => {});
    const detail = openStatus();
    expect(within(detail).queryByRole("button", { name: "Retry" }) !== null).toBe(retry);
  });

  test.each(["partial", "complete"] as const)("keeps summary figures still and animates legend figures only when %s is complete", (status) => {
    const snapshot = buildBalancesSnapshotFixture({
      registry: { ...cash, eth: { balance: ready("1"), value: priced("USD", "100") } },
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "7821"),
        debtBaseUnits: "30010000", debtValue: priced("USD", "3001"),
      })] },
    });
    for (const total of [snapshot.totals.cash, snapshot.totals.investments, snapshot.totals.borrow]) {
      total.status = status;
    }
    statusOverview(presentHomeBalances({ status: "ready", snapshot, error: null }));
    const summary = within(within(document.body).getByRole("region", { name: "Your money" }));
    for (const description of ["Open Cash", "Open Investments", "Open Borrow"]) {
      const ticker = within(summary.getByRole("button", { description })).getByRole("img");
      expect(ticker.getAttribute("data-animated")).toBe("false");
    }
    for (const id of ["cash", "investments", "borrow"] as const) {
      const ticker = within(legendButton(id)).getByRole("img");
      expect(ticker.getAttribute("data-animated")).toBe(String(status === "complete"));
    }
  });

  test("keeps partial pending cash-out legend figures still", () => {
    render(overview([
      ...initial,
      { id: "pending-cash-out", label: "Pending cash-out", value: "$20.00", weight: 500, status: "partial" },
    ], "account-a"));
    expect(within(legendButton("pending-cash-out")).getByRole("img").getAttribute("data-animated")).toBe("false");
  });

  test("withholds the total for an unpriceable loan and never shows $0.00", () => {
    statusOverview(presented({
      borrow: { coverage: "complete", positions: [borrowPosition({
        collateralBaseUnits: "100000", collateralValue: priced("USD", "7821"),
        debtBaseUnits: "30010000", debtValue: { status: "unpriced", reason: "price-unavailable" },
      })] },
    }), () => {});
    const hero = within(document.body).getByLabelText("Total balance");
    expect(within(hero).getByRole("img", { name: "Unavailable", description: "Balance unavailable" }).textContent).toBe("—");
    const detail = openStatus();
    expect(detail.textContent).toContain("A loan couldn’t be priced, so the total can’t be shown.");
    expect(detail.textContent).not.toContain("Total counts only");
    const borrow = legendButton("borrow");
    expect(borrow.textContent).toContain("—");
    expect(borrow.textContent).toContain("Unavailable");
    expect(document.querySelector("[data-balance-segment='borrow']")).toBeNull();
    expect(document.querySelector("[data-balance-axis]")).toBeNull();
    expect(within(document.body).getByRole("button", { name: "Retry Borrow balance" })).toBeTruthy();
  });

  test("never presents $0.00 when every balance is unavailable", () => {
    const registry = Object.fromEntries(buildBalancesSnapshotFixture().holdings.map(({ id }) => [id, { balance: unavailableBalance }]));
    statusOverview(presented({ registry }), () => {});
    expect(document.body.textContent).not.toContain("$0.00");
    expect(openStatus().textContent).toContain("Some balances couldn’t be read.");
  });

  test("explains a failed read without reasons", () => {
    statusOverview(presentHomeBalances({ status: "error", snapshot: null, error: "balances-unavailable" }));
    const detail = openStatus();
    expect(detail.textContent).toContain("Balances are unavailable");
    expect(within(detail).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("marks partial summary rows and breakdown parts without muting their amounts", () => {
    statusOverview(presented({
      registry: { ...cash, eth: { balance: ready("1"), value: priced("USD", "100") }, cbbtc: { balance: unavailableBalance } },
    }));
    const investments = within(document.body).getByRole("button", { description: "Open Investments" });
    expect(investments.textContent).toContain("Partial balance");
    expect(investments.querySelector("[data-value-tone]")?.getAttribute("data-value-tone")).toBe("default");
    const part = legendButton("investments");
    expect(part.textContent).toContain("$1.00");
    expect(part.textContent).toContain("Partial");
  });
});
