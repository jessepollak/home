import { describe, expect, test } from "bun:test";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import type { ShellLocation } from "@/config/shell-location";
import { readHomeInboundPanelState } from "./panel-routing";

function location(panel: ShellLocation["panel"], rest: Partial<ShellLocation> = {}): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, group: null, market: null, ...rest };
}

const inboundCases = [
  {
    name: "balances with a group segment",
    location: location("balances"),
    search: "",
    expected: {
      panel: "balances",
      account: null,
      location: location("balances"),
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    name: "an account overlay on the canonical page",
    location: location("activity"),
    search: "account=settings",
    expected: {
      panel: "activity",
      account: "settings",
      location: location("activity"),
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    name: "a funding provider return on /home",
    location: location("home"),
    search: "return=funding",
    expected: {
      panel: "home",
      account: null,
      location: location("home"),
      addMoney: true,
      returnedFromProvider: true,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
  {
    name: "a send flow with its action id",
    location: location("home"),
    search: "flow=send&action=11111111-1111-4111-8111-111111111111",
    expected: {
      panel: "home",
      account: null,
      location: location("home"),
      addMoney: false,
      returnedFromProvider: false,
      flow: "send",
      sendFlow: true,
      actionId: "11111111-1111-4111-8111-111111111111",
    },
  },
  {
    name: "a save deposit flow on Save",
    location: location("save"),
    search: "flow=save-deposit",
    expected: {
      panel: "save",
      account: null,
      location: location("save"),
      addMoney: false,
      returnedFromProvider: false,
      flow: "save-deposit",
      sendFlow: false,
      actionId: null,
    },
  },
  {
    name: "a borrow market path with an unrelated flow query",
    location: location("borrow", { market: BORROW_MARKET_ID }),
    search: "panel=home&group=cash",
    expected: {
      panel: "borrow",
      account: null,
      location: location("borrow", { market: BORROW_MARKET_ID }),
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    },
  },
] as const;

describe("home panel routing", () => {
  for (const entry of inboundCases) {
    test(`parses ${entry.name}`, () => {
      expect(readHomeInboundPanelState(entry.location, new URLSearchParams(entry.search)))
        .toEqual(entry.expected);
    });
  }
});
