import "@/client/account/dom-test-harness";
import { createElement } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";

const BORROW_MARKET_ID = DEFAULT_BORROW_MARKET.marketId;
import { homeHrefWithOverlays, type ShellLocation } from "@/config/shell-location";
import { readHomeInboundPanelState, useActivityReturnOwnerBoundary, type ActivityDetailReturn, type HomeShellRouting } from "./panel-routing";
const { cleanup, render } = await import("@testing-library/react");

function location(panel: ShellLocation["panel"], rest: Partial<ShellLocation> = {}): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, market: null, cashView: null, ...rest };
}

const ACTION_ID = "11111111-1111-4111-8111-111111111111";

describe("home panel routing", () => {
  test("homeHrefWithOverlays drops non-allowlisted keys", () => {
    expect(homeHrefWithOverlays({ account: "settings", token: "secret" })).toBe("/home?account=settings");
    expect(homeHrefWithOverlays({ token: "secret", panel: "borrow" })).toBe("/home");
  });

  test("combines the explicit page location with empty overlays", () => {
    expect(readHomeInboundPanelState(location("cash"), new URLSearchParams())).toEqual({
      panel: "cash",
      account: null,
      location: location("cash"),
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

  test("maps send flows and their action id, and savings flows to Cash detail", () => {
    expect(readHomeInboundPanelState(
      location("home"),
      new URLSearchParams(`flow=send&action=${ACTION_ID}`),
    )).toMatchObject({ panel: "home", flow: "send", sendFlow: true, actionId: ACTION_ID });
    expect(readHomeInboundPanelState(location("cash", { cashView: "savings" }), new URLSearchParams("flow=save-deposit")))
      .toMatchObject({ panel: "cash", location: { cashView: "savings" }, flow: "save-deposit", sendFlow: false, actionId: null });
    expect(readHomeInboundPanelState(
      location("borrow", { market: BORROW_MARKET_ID }),
      new URLSearchParams("panel=home&group=cash"),
    ).location).toEqual(location("borrow", { market: BORROW_MARKET_ID }));
  });
});

type RoutingFence = Pick<HomeShellRouting, "getActivityReturn" | "setActivityReturn">;

function Probe({ owner, routing }: { owner: string | null; routing: RoutingFence }) {
  useActivityReturnOwnerBoundary(owner, routing);
  return null;
}

afterEach(() => cleanup());

describe("activity return owner boundary", () => {
  test("clears a remembered detail after an owner change and keeps it through a same-owner revalidation", () => {
    const item = { id: "detail" } as unknown as ActivityDetailReturn["item"];
    let stored: ActivityDetailReturn | null = {
      ownerKey: "A", panel: "activity", path: "/activity", item, opening: false, suspended: false,
    };
    const routing: RoutingFence = {
      getActivityReturn: () => stored,
      setActivityReturn: (value) => { stored = value; },
    };
    const view = render(createElement(Probe, { owner: "A", routing }));
    expect(stored?.ownerKey).toBe("A");
    view.rerender(createElement(Probe, { owner: null, routing }));
    view.rerender(createElement(Probe, { owner: "A", routing }));
    expect(stored?.ownerKey).toBe("A");
    view.rerender(createElement(Probe, { owner: "B", routing }));
    expect(stored).toBeNull();
    view.rerender(createElement(Probe, { owner: "A", routing }));
    expect(stored).toBeNull();
  });
});
