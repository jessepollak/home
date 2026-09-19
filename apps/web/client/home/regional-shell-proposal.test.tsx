import "@/client/account/dom-test-harness";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  RegionalHomeShellProposal,
  type RegionalHomeComposition,
  type RegionalHomeCopy,
} from "./regional-shell-proposal";

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
