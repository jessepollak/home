import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MoneyBreakdownLegend, SignedBalanceBar } from "./signed-balance-bar";
import type { MoneyBreakdownItem } from "@/shared/balances/present";

afterEach(cleanup);

const partial: MoneyBreakdownItem = { id: "cash", label: "Cash", status: "partial", value: "$12.34", weight: 600 };
const unavailable: MoneyBreakdownItem = { id: "cash", label: "Cash", status: "unavailable", value: null, weight: 0 };

describe("MoneyBreakdownLegend unavailable entries", () => {
  test("keeps focus on the same control when an entry becomes unavailable and recovers", () => {
    const view = render(
      <MoneyBreakdownLegend items={[partial]} selectedId={null} onSelect={() => undefined} />,
    );
    const control = view.getByRole("button", { name: /Cash/ });
    control.focus();

    view.rerender(
      <MoneyBreakdownLegend items={[unavailable]} selectedId={null} onSelect={() => undefined} />,
    );
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.getAttribute("tabindex")).toBe("-1");
    expect(control.hasAttribute("aria-pressed")).toBe(false);

    view.rerender(
      <MoneyBreakdownLegend items={[partial]} selectedId={null} onSelect={() => undefined} />,
    );
    expect(document.activeElement).toBe(control);
    expect(control.hasAttribute("aria-disabled")).toBe(false);
    expect(control.hasAttribute("tabindex")).toBe(false);
  });

  test("does not select an unavailable entry and keeps other entries selectable", () => {
    const selections: MoneyBreakdownItem["id"][] = [];
    const investments: MoneyBreakdownItem = { id: "investments", label: "Investments", status: "complete", value: "$78.21", weight: 400 };
    const view = render(
      <MoneyBreakdownLegend
        items={[unavailable, investments]}
        selectedId={null}
        onSelect={(id) => selections.push(id)}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: /Cash/ }));
    expect(selections).toEqual([]);

    fireEvent.click(view.getByRole("button", { name: /Investments/ }));
    expect(selections).toEqual(["investments"]);
  });

  test("does not mark an unavailable entry as selected", () => {
    const view = render(
      <MoneyBreakdownLegend items={[unavailable]} selectedId="cash" onSelect={() => undefined} />,
    );
    const entry = view.container.querySelector<HTMLElement>("[data-breakdown-item='cash']");
    if (!entry) throw new Error("missing cash breakdown entry");
    expect(entry.getAttribute("data-selected")).toBeNull();
    expect(within(entry).getByRole("button").getAttribute("aria-pressed")).toBeNull();
  });
});

describe("SignedBalanceBar", () => {
  test("keeps the Borrow axis when a small debt rounds to no visible segment", () => {
    const items: MoneyBreakdownItem[] = [
      { id: "borrow", label: "Borrow", status: "complete", value: "−$1.00", weight: 0 },
      { id: "cash", label: "Cash", status: "complete", value: "$5,000.00", weight: 1000 },
    ];
    const view = render(<SignedBalanceBar items={items} selectedId={null} onSelect={() => undefined} />);

    expect(view.container.querySelector("[data-balance-axis]")).toBeTruthy();
    expect(view.container.querySelector("[data-balance-segment='borrow']")).toBeTruthy();
    expect(view.container.querySelector("[data-balance-segment='cash']")).toBeTruthy();
  });

  test("draws no Borrow axis while the debt is unavailable", () => {
    const items: MoneyBreakdownItem[] = [
      { id: "borrow", label: "Borrow", status: "unavailable", value: null, weight: 0 },
      { id: "cash", label: "Cash", status: "complete", value: "$5,000.00", weight: 1000 },
    ];
    const view = render(<SignedBalanceBar items={items} selectedId={null} onSelect={() => undefined} />);

    expect(view.container.querySelector("[data-balance-axis]")).toBeNull();
    expect(view.container.querySelector("[data-balance-segment='borrow']")).toBeNull();
  });
});
