import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  RegionalHomeShellProposal,
  type RegionalHomeComposition,
  type RegionalHomeCopy,
} from "./regional-shell-proposal";
import { regionalHomeCompositions } from "./regional-shell-proposal-fixtures";

afterEach(cleanup);

const copy: RegionalHomeCopy = {
  account: "Account",
  activity: "Activity",
  addMoney: "Add money",
  card: "Card",
  cashOut: "Cash out",
  countryNeeded: "Country needed",
  dollarProducts: "Dollar products",
  home: "Home",
  invest: "Invest",
  illustrativeNonCoverage: "Illustrative only — coverage not assessed",
  localMoney: "Local money",
  localYieldUnavailable: "Local yield unavailable",
  send: "Send",
  shownSeparately: "Shown separately",
  totalBalance: "Total balance",
};

const composition: RegionalHomeComposition = {
  regionLabel: "Brazil · BRL",
  totalBalance: "R$ 68.400,20",
  localMoney: { title: "Local money", value: "R$ 55.810,12", detail: "Local balance" },
  dollarProducts: { title: "Dollar products", value: "$2,140.08", detail: "Stays in USD" },
  localYield: { title: "Local savings", detail: "Not available", state: "unavailable" },
  activity: [],
};

describe("RegionalHomeShellProposal", () => {
  test("dispatches each first-class money intent without combining them", () => {
    const onAction = mock((action: "add-money" | "send" | "cash-out") => { void action; });
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={() => {}}
        onAction={onAction}
        onNavigate={() => {}}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Add money" }));
    fireEvent.click(view.getByRole("button", { name: "Send" }));
    fireEvent.click(view.getByRole("button", { name: "Cash out" }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      "add-money",
      "send",
      "cash-out",
    ]);
  });

  test("gives all three money actions the same visual treatment", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    const actions = ["Add money", "Send", "Cash out"].map((name) =>
      view.getByRole("button", { name }),
    );
    expect(actions.map((action) => action.getAttribute("data-money-action-treatment"))).toEqual([
      "outline",
      "outline",
      "outline",
    ]);
  });

  test("uses native headings and labelled sections inside the product cards", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    for (const name of ["Local money", "Dollar products", "Local savings", "Activity"]) {
      const heading = view.getByRole("heading", { level: 2, name });
      const region = view.getByRole("region", { name });
      expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(heading.parentElement?.getAttribute("data-slot")).toBe("card-title");
    }
  });

  test("marks the US story fixture as illustrative without claiming coverage", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={regionalHomeCompositions.US}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    const state = view.getByText(copy.illustrativeNonCoverage);
    expect(state.getAttribute("data-capability-state")).toBe("illustrative");
    expect(
      view.getByText(
        "Illustrative placement only; this fixture does not assess regional coverage.",
      ),
    ).toBeTruthy();
    expect(view.queryByText(copy.shownSeparately)).toBeNull();
    expect(view.queryByText(copy.localYieldUnavailable)).toBeNull();
    expect(view.queryByText(copy.countryNeeded)).toBeNull();
  });

  test("keeps Home, Card, Invest and Account as independent navigation intents", () => {
    const onNavigate = mock((destination: "home" | "card" | "invest") => { void destination; });
    const onAccount = mock(() => {});
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={onAccount}
        onAction={() => {}}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(view.getAllByRole("button", { name: "Card" })[0]);
    fireEvent.click(view.getAllByRole("button", { name: "Invest" })[0]);
    fireEvent.click(view.getAllByRole("button", { name: "Account" })[0]);

    expect(onNavigate.mock.calls.map(([destination]) => destination)).toEqual(["card", "invest"]);
    expect(onAccount).toHaveBeenCalledTimes(1);
  });
});
