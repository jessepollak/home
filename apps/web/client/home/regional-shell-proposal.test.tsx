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
  activityEmpty: "No transactions yet",
  addMoney: "Add money",
  card: "Card",
  cashOut: "Cash out",
  countryNeeded: "Country needed",
  desktopPrimaryNavigation: "Desktop navigation",
  dollarProducts: "Dollar products",
  home: "Home",
  invest: "Invest",
  localMoney: "Local money",
  localYieldUnavailable: "Local yield unavailable",
  mobilePrimaryNavigation: "Mobile navigation",
  moneyActions: "Balance actions",
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

  test("renders the established localized empty presentation when activity has no rows", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    const empty = view.getByText("No transactions yet");
    expect(empty.getAttribute("data-slot")).toBe("empty-title");
  });

  test("uses explicit activity direction for icons instead of signed amount text", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={{
          ...composition,
          activity: [
            {
              id: "incoming-with-negative-copy",
              direction: "incoming",
              label: "Incoming transfer",
              detail: "Today",
              amount: "− $10.00",
            },
            {
              id: "outgoing-with-positive-copy",
              direction: "outgoing",
              label: "Outgoing transfer",
              detail: "Yesterday",
              amount: "+ $20.00",
            },
          ],
        }}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    const incomingRow = view.getByText("Incoming transfer").closest("[role='listitem']");
    const outgoingRow = view.getByText("Outgoing transfer").closest("[role='listitem']");
    expect(
      incomingRow?.querySelector(
        "[data-activity-direction='incoming'] [data-activity-icon='arrow-down-to-line']",
      ),
    ).toBeTruthy();
    expect(
      outgoingRow?.querySelector(
        "[data-activity-direction='outgoing'] [data-activity-icon='arrow-up-from-line']",
      ),
    ).toBeTruthy();
  });

  test("uses copy contracts for money-action and responsive navigation labels", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={composition}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(view.getByRole("group", { name: "Balance actions" })).toBeTruthy();
    expect(view.getByRole("navigation", { name: "Desktop navigation" })).toBeTruthy();
    expect(view.getByRole("navigation", { name: "Mobile navigation" })).toBeTruthy();
  });

  test("omits local yield and disclaimer copy from the US story fixture", () => {
    const view = render(
      <RegionalHomeShellProposal
        composition={regionalHomeCompositions.US}
        copy={copy}
        onAccount={() => {}}
        onAction={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(view.container.querySelector("#local-yield-heading")).toBeNull();
    expect(view.container.querySelector("[data-capability-state]")).toBeNull();
    expect(view.queryByText("Dollar savings layout")).toBeNull();
    expect(view.container.textContent).not.toMatch(/coverage|illustrative placement/i);
    expect(view.queryByText(copy.shownSeparately)).toBeNull();
    expect(view.queryByText(copy.localYieldUnavailable)).toBeNull();
    expect(view.queryByText(copy.countryNeeded)).toBeNull();
  });

  test("retains the intended local-yield states in the other deterministic fixtures", () => {
    const fixtures = [
      {
        composition: regionalHomeCompositions.GLOBAL,
        heading: "Local savings",
        state: "choose-country",
        stateCopy: copy.countryNeeded,
      },
      {
        composition: regionalHomeCompositions.BR,
        heading: "Rendimento em reais",
        state: "unavailable",
        stateCopy: copy.localYieldUnavailable,
      },
      {
        composition: regionalHomeCompositions.NG,
        heading: "Naira savings",
        state: "unavailable",
        stateCopy: copy.localYieldUnavailable,
      },
      {
        composition: regionalHomeCompositions.ID,
        heading: "Tabungan rupiah",
        state: "unavailable",
        stateCopy: copy.localYieldUnavailable,
      },
    ] as const;

    for (const fixture of fixtures) {
      const view = render(
        <RegionalHomeShellProposal
          composition={fixture.composition}
          copy={copy}
          onAccount={() => {}}
          onAction={() => {}}
          onNavigate={() => {}}
        />,
      );

      expect(view.getByRole("region", { name: fixture.heading })).toBeTruthy();
      expect(
        view.getByText(fixture.stateCopy).getAttribute("data-capability-state"),
      ).toBe(fixture.state);
      view.unmount();
    }
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
