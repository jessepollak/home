import { describe, expect, test } from "bun:test";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import {
  flowHref,
  parseInboundUrlIntent,
  parseShellLocation,
  searchParamsToString,
  shellHref,
  withoutFlowHref,
} from "./shell-location";

describe("shell location", () => {
  test("treats a bare dashboard path as Home with no overlays", () => {
    expect(parseShellLocation(new URLSearchParams())).toEqual({
      panel: "home",
      account: null,
      shelf: null,
      asset: null,
      group: null,
      market: null,
    });
    expect(shellHref("/dashboard")).toBe("/dashboard");
  });

  test("encodes shell panels and account settings", () => {
    const cases = [
      [{ panel: "save" as const }, "/dashboard?panel=save"],
      [{ panel: "balances" as const }, "/dashboard?panel=balances"],
      [{ panel: "balances" as const, group: "investments" as const }, "/dashboard?panel=balances&group=investments"],
      [{ panel: "activity" as const }, "/dashboard?panel=activity"],
      [{ panel: "borrow" as const }, "/dashboard?panel=borrow"],
      [{ panel: "invest" as const, shelf: "crypto" }, "/dashboard?panel=invest&shelf=crypto"],
      [{ panel: "invest" as const, asset: "cbbtc", shelf: "crypto" }, "/dashboard?panel=invest&shelf=crypto&asset=cbbtc"],
      [{ account: "settings" as const }, "/dashboard?account=settings"],
    ] as const;
    for (const [location, expected] of cases) {
      expect(shellHref("/dashboard", location)).toBe(expected);
    }
    expect(shellHref("/", { account: "signin" })).toBe("/?account=signin");
    expect(shellHref("/dashboard", { panel: "borrow", market: BORROW_MARKET_ID }))
      .toBe(`/dashboard?panel=borrow&market=${BORROW_MARKET_ID}`);
  });

  test("parses the allowed inbound intents through one schema", () => {
    expect(parseInboundUrlIntent(new URLSearchParams(
      "panel=invest&shelf=crypto&asset=cbbtc&return=funding&add-money=1&flow=send&action=11111111-1111-4111-8111-111111111111",
    ))).toEqual({
      kind: "inbound-url-intent",
      location: {
        panel: "invest",
        account: null,
        shelf: "crypto",
        asset: "cbbtc",
        group: null,
        market: null,
      },
      returnedFromFunding: true,
      addMoney: true,
      flow: "send",
      actionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("allowlists every addressable money flow and opens Save flows on Save", () => {
    const cases = [
      ["send", "home"],
      ["add-money", "home"],
      ["receive", "home"],
      ["save-deposit", "save"],
      ["save-withdraw", "save"],
    ] as const;
    for (const [flow, panel] of cases) {
      const intent = parseInboundUrlIntent(new URLSearchParams(`flow=${flow}`));
      expect(intent.flow).toBe(flow);
      expect(intent.location.panel).toBe(panel);
    }
  });

  test("allowlists money-group anchors only on Your money", () => {
    expect(parseShellLocation(new URLSearchParams("panel=balances&group=cash"))).toMatchObject({
      panel: "balances",
      group: "cash",
    });
    expect(parseShellLocation(new URLSearchParams("panel=balances&group=stocks")).group).toBeNull();
    expect(parseShellLocation(new URLSearchParams("panel=home&group=investments")).group).toBeNull();
  });

  test("ignores malformed or unknown inbound values", () => {
    expect(parseInboundUrlIntent({
      panel: "explore",
      account: "profile",
      shelf: "scams",
      asset: "javascript:alert(1)",
      return: "evil",
      "add-money": "yes",
      flow: "withdraw",
      action: "not-an-id",
    })).toEqual({
      kind: "inbound-url-intent",
      location: { panel: "home", account: null, shelf: null, asset: null, group: null, market: null },
      returnedFromFunding: false,
      addMoney: false,
      flow: null,
      actionId: null,
    });
  });

  test("accepts action ids only for Send", () => {
    expect(parseInboundUrlIntent(new URLSearchParams(
      "flow=receive&action=11111111-1111-4111-8111-111111111111",
    )).actionId).toBeNull();
  });

  test("validates configured Borrow markets and ignores market state elsewhere", () => {
    expect(parseShellLocation({ panel: "borrow", market: BORROW_MARKET_ID })).toMatchObject({
      panel: "borrow",
      market: BORROW_MARKET_ID,
    });
    expect(parseShellLocation({ panel: "borrow", market: `0x${"ff".repeat(32)}` }).market).toBeNull();
    expect(parseShellLocation({ panel: "home", market: BORROW_MARKET_ID }).market).toBeNull();
  });

  test("ignores invest params unless the panel is Invest", () => {
    expect(parseShellLocation({ panel: "save", shelf: "crypto", asset: "cbbtc" }))
      .toEqual({ panel: "save", account: null, shelf: null, asset: null, group: null, market: null });
  });
});

describe("money flow location", () => {
  test("adds and removes only allowlisted flow state without URL payloads", () => {
    const balances = new URLSearchParams("panel=balances");
    expect(flowHref("/dashboard", "send", null, balances)).toBe(
      "/dashboard?panel=balances&flow=send",
    );
    expect(flowHref(
      "/dashboard",
      "send",
      "11111111-1111-4111-8111-111111111111",
      balances,
    )).toBe("/dashboard?panel=balances&flow=send&action=11111111-1111-4111-8111-111111111111");
    expect(flowHref(
      "/dashboard",
      "receive",
      "11111111-1111-4111-8111-111111111111",
      balances,
    )).toBe("/dashboard?panel=balances&flow=receive");
    expect(withoutFlowHref(
      "/dashboard",
      new URLSearchParams("panel=balances&flow=send&action=11111111-1111-4111-8111-111111111111"),
    )).toBe("/dashboard?panel=balances");
  });
});

describe("searchParamsToString", () => {
  test("serializes a server page's searchParams, including repeated keys", () => {
    expect(searchParamsToString({ account: "signin", flow: "send", tags: ["a", "b"], missing: undefined }))
      .toBe("account=signin&flow=send&tags=a&tags=b");
    expect(searchParamsToString({})).toBe("");
  });
});
