import { describe, expect, test } from "bun:test";
import { homePanelHref, readHomeInboundPanelState } from "./panel-routing";

const inboundCases = [
  {
    search: "panel=balances",
    expected: {
      panel: "balances",
      account: null,
      location: { panel: "balances", account: null, shelf: null, asset: null },
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    search: "panel=activity&account=settings",
    expected: {
      panel: "activity",
      account: "settings",
      location: { panel: "activity", account: "settings", shelf: null, asset: null },
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    search: "return=funding",
    expected: {
      panel: "home",
      account: null,
      location: { panel: "home", account: null, shelf: null, asset: null },
      addMoney: true,
      returnedFromProvider: true,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    search: "flow=send&action=11111111-1111-4111-8111-111111111111",
    expected: {
      panel: "home",
      account: null,
      location: { panel: "home", account: null, shelf: null, asset: null },
      addMoney: false,
      returnedFromProvider: false,
      flow: "send",
      sendFlow: true,
      actionId: "11111111-1111-4111-8111-111111111111",
    },
  },
  {
    search: "flow=save-deposit",
    expected: {
      panel: "save",
      account: null,
      location: { panel: "save", account: null, shelf: null, asset: null },
      addMoney: false,
      returnedFromProvider: false,
      flow: "save-deposit",
      sendFlow: false,
      actionId: null,
    },
  },
] as const;

describe("home panel routing", () => {
  for (const entry of inboundCases) {
    test(`parses ${entry.search}`, () => {
      expect(readHomeInboundPanelState(new URLSearchParams(entry.search))).toEqual(entry.expected);
    });
  }

  test("maps panels to shallow shell URLs", () => {
    expect(homePanelHref("/dashboard", "home")).toBe("/dashboard");
    expect(homePanelHref("/dashboard", "balances")).toBe("/dashboard?panel=balances");
    expect(homePanelHref("/", "invest")).toBe("/?panel=invest");
  });
});
