import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { MoneyBreakdownItem } from "@/shared/balances/present";
import { HomeOverview } from "./home-overview";

const initial: MoneyBreakdownItem[] = [
  { id: "cash", label: "Cash", value: "$1.00", weight: 100 },
  { id: "investments", label: "Investments", value: "$9.00", weight: 900 },
];

function overview(items: MoneyBreakdownItem[], accountKey: string | null) {
  return (
    <HomeOverview
      assetBalances={{
        status: "ready",
        displayTotal: "$10.00",
        totalStatus: "complete",
        groups: [],
        breakdown: items,
        summary: null,
        rows: [],
        hiddenRows: [],
        hiddenCount: 0,
      }}
      accountKey={accountKey}
      actions={null}
      activity={null}
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
});
