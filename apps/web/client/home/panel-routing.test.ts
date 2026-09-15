import { describe, expect, test } from "bun:test";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import type { ShellLocation } from "@/config/shell-location";
import { readHomeInboundPanelState } from "./panel-routing";

function location(panel: ShellLocation["panel"], rest: Partial<ShellLocation> = {}): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, group: null, market: null, ...rest };
}

const ACTION_ID = "11111111-1111-4111-8111-111111111111";

describe("home panel routing", () => {
  test("combines the explicit page location with empty overlays", () => {
    expect(readHomeInboundPanelState(location("balances"), new URLSearchParams())).toEqual({
      panel: "balances",
      account: null,
      location: location("balances"),
      addMoney: false,
      returnedFromProvider: false,
      flow: null,
      sendFlow: false,
      actionId: null,
    });
  });

  test("carries the account overlay without changing the page", () => {
    expect(readHomeInboundPanelState(location("activity"), new URLSearchParams("account=settings")))
      .toEqual({
        panel: "activity",
        account: "settings",
        location: location("activity"),
        addMoney: false,
        returnedFromProvider: false,
        flow: null,
        sendFlow: false,
        actionId: null,
      });
  });

  test("treats a funding provider return as an add-money intent", () => {
    expect(readHomeInboundPanelState(location("home"), new URLSearchParams("return=funding")))
      .toMatchObject({ panel: "home", addMoney: true, returnedFromProvider: true, flow: null });
    expect(readHomeInboundPanelState(location("home"), new URLSearchParams("add-money=1")))
      .toMatchObject({ addMoney: true, returnedFromProvider: false });
  });

  test("maps send flows and their action id, and save flows to Save", () => {
    expect(readHomeInboundPanelState(
      location("home"),
      new URLSearchParams(`flow=send&action=${ACTION_ID}`),
    )).toMatchObject({ panel: "home", flow: "send", sendFlow: true, actionId: ACTION_ID });
    expect(readHomeInboundPanelState(location("save"), new URLSearchParams("flow=save-deposit")))
      .toMatchObject({ panel: "save", flow: "save-deposit", sendFlow: false, actionId: null });
    // The market segment is page state; unrelated query keys never touch it.
    expect(readHomeInboundPanelState(
      location("borrow", { market: BORROW_MARKET_ID }),
      new URLSearchParams("panel=home&group=cash"),
    ).location).toEqual(location("borrow", { market: BORROW_MARKET_ID }));
  });
});
