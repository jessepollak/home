import { describe, expect, test } from "bun:test";
import { BORROW_MARKETS } from "@/shared/borrowing/config";
import { erc20AssetKey, nativeAssetKey } from "@/shared/balances/types";
import {
  flowHref, homeHrefWithOverlays, isCanonicalShellPathname, legacyShellRedirectHref, parseInboundUrlIntent,
  parseShellLocation, parseShellOverlayIntent, readClientHistoryFlag, readShellHistoryOrigin, searchParamsToString, shellHref, withoutFlowHref, writeShellHistoryOrigin,
  type ShellHistoryFlag, type ShellLocation,
} from "./shell-location";

const DYNAMIC_ASSET_ID = "base:0x1111111111111111111111111111111111111111";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
function location(panel: ShellLocation["panel"], rest: Partial<ShellLocation> = {}): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, market: null, cashView: null, holding: null, ...rest };
}
const canonicalLocations: Array<[string, ShellLocation]> = [
  ["/home", location("home")],
  ["/activity", location("activity")], ["/cash", location("cash")],
  ["/cash/savings", location("cash", { cashView: "savings" })],
  ["/borrow", location("borrow")],
  ["/investments", location("investments")],
  ["/investments/native", location("investments", { holding: nativeAssetKey() })],
  [`/investments/0x${"ab".repeat(20)}`, location("investments", { holding: erc20AssetKey(`0x${"ab".repeat(20)}`) })],
  ...BORROW_MARKETS.map((market): [string, ShellLocation] => [`/borrow/${market.marketId}`, location("borrow", { market: market.marketId })]),
  ["/invest", location("invest")], ["/invest/stocks", location("invest", { shelf: "stocks" })],
  ["/invest/crypto", location("invest", { shelf: "crypto" })],
  ["/invest/memes", location("invest", { shelf: "memes" })],
  ["/invest/cbbtc", location("invest", { asset: "cbbtc" })],
  [`/invest/${DYNAMIC_ASSET_ID}`, location("invest", { asset: DYNAMIC_ASSET_ID })],
  [`/invest/${encodeURIComponent(DYNAMIC_ASSET_ID)}`, location("invest", { asset: DYNAMIC_ASSET_ID })],
];
const fallbackLocations: Array<[string, ShellLocation]> = [
  ["/", location("home")], ["/dashboard", location("home")],
  ["/unknown", location("home")], ["/dashboard/panel", location("home")],
  ["/%zz", location("home")], ["/balances/grocery", location("home")],
  ["/balances/cash/extra", location("home")], ["/borrow/not-a-market", location("borrow")],
  [`/borrow/0x${"ff".repeat(32)}`, location("borrow")],
  ["/investments/nope", location("investments")],
  ["/investments/native/extra", location("investments")],
  ["/investments/%zz", location("investments")],
  [`/investments/0x${"ff".repeat(19)}`, location("investments")],
  ["/invest/forex", location("invest")], ["/invest/not-an-asset", location("invest")],
  ["/invest/base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", location("invest")],
  ["/home/nope", location("home")], ["/cash/nope", location("cash")],
  ["/cash/savings/extra", location("cash")], ["/save", location("cash", { cashView: "savings" })],
  ["/save/nope", location("cash", { cashView: "savings" })], ["/activity/nope", location("activity")],
];

describe("shell location", () => {
  test("reads a history flag only when its stored value is boolean true", () => {
    const flag = "fundingFlowPushed";
    const key = "__homeFundingFlowPushed";
    expect(readClientHistoryFlag(flag, { [key]: true })).toBe(true);
    expect(readClientHistoryFlag("cashSavingsFlowPushed")).toBe(false);
    for (const state of [undefined, null, "true", 1, [], {}, { [key]: "true" }, { [key]: 1 }, { [key]: false }]) {
      expect(readClientHistoryFlag(flag, state)).toBe(false);
    }
  });
  test("keeps each history flag independent and recognizes every written key", () => {
    const onlyFunding = { __homeFundingFlowPushed: true };
    expect(readClientHistoryFlag("fundingFlowPushed", onlyFunding)).toBe(true);
    const otherFlags: ShellHistoryFlag[] = ["cashSavingsFlowPushed"];
    for (const flag of otherFlags) {
      expect(readClientHistoryFlag(flag, onlyFunding)).toBe(false);
    }
    const writtenState = {
      __homeFundingFlowPushed: true,
      __cashSavingsFlowPushed: true,
    };
    const flags: ShellHistoryFlag[] = ["fundingFlowPushed", ...otherFlags];
    for (const flag of flags) {
      expect(readClientHistoryFlag(flag, writtenState)).toBe(true);
    }
  });
  test("round-trips every canonical L1, asset, and verified Borrow market path", () => {
    for (const [pathname, expected] of canonicalLocations) {
      expect(parseShellLocation(pathname)).toEqual(expected);
      expect(parseShellLocation(shellHref(expected))).toEqual(expected);
    }
  });
  test("falls back to /home or the canonical parent for non-canonical paths", () => {
    for (const [pathname, expected] of fallbackLocations) expect(parseShellLocation(pathname)).toEqual(expected);
  });
  test("emits canonical pathnames and never page-routing query keys", () => {
    const cases = [
      [{}, "/home"], [{ panel: "cash" as const }, "/cash"],
      [{ panel: "cash" as const, cashView: "savings" as const }, "/cash/savings"],
      [{ panel: "investments" as const, holding: nativeAssetKey() }, "/investments/native"],
      [{ panel: "investments" as const, holding: erc20AssetKey(`0x${"AB".repeat(20)}`) }, `/investments/0x${"ab".repeat(20)}`],
      [{ panel: "invest" as const, shelf: "stocks" }, "/invest/stocks"],
      ...BORROW_MARKETS.map((market) => [{ panel: "borrow" as const, market: market.marketId }, `/borrow/${market.marketId}`] as const),
      [{ account: "settings" as const }, "/home?account=settings"],
      [{ panel: "invest" as const, asset: "cbbtc", shelf: "crypto" }, "/invest/cbbtc"],
      [{ panel: "borrow" as const, market: `0x${"ff".repeat(32)}` }, "/borrow"],
    ] as const;
    for (const [value, expected] of cases) expect(shellHref(value)).toBe(expected);
  });
  test("normalizes owned ERC-20 case while preserving Invest discovery and overlay parsing", () => {
    const upper = `0x${"AB".repeat(20)}`;
    const lower = `0x${"ab".repeat(20)}`;
    expect(parseShellLocation(`/investments/${upper}`).holding).toBe(erc20AssetKey(lower));
    expect(shellHref(parseShellLocation(`/investments/${upper}`))).toBe(`/investments/${lower}`);
    expect(parseInboundUrlIntent("/investments/native", new URLSearchParams("account=settings&flow=send")))
      .toMatchObject({ location: location("investments", { account: "settings", holding: nativeAssetKey() }), flow: "send" });
    expect(parseInboundUrlIntent(`/investments/${lower}`, new URLSearchParams("flow=send")))
      .toMatchObject({ location: location("investments", { holding: erc20AssetKey(lower) }), flow: "send" });
    expect(parseShellLocation("/invest/stocks")).toEqual(location("invest", { shelf: "stocks" }));
    expect(parseShellLocation("/invest/cbbtc")).toEqual(location("invest", { asset: "cbbtc" }));
  });
  test("combines pathname page state with allowlisted overlay query state", () => {
    expect(parseInboundUrlIntent("/cash", new URLSearchParams(
      `account=settings&flow=send&action=${ACTION_ID}&return=funding&add-money=1`,
    ))).toEqual({
      kind: "inbound-url-intent", location: location("cash", { account: "settings" }),
      returnedFromFunding: true, addMoney: true, flow: "send", actionId: ACTION_ID,
    });
  });
  test("never lets obsolete, malformed, or misplaced query values select a page or open flows", () => {
    expect(parseInboundUrlIntent("/home", new URLSearchParams(
      "panel=balances&shelf=crypto&asset=cbbtc&group=investments&market=not-a-market",
    )).location).toEqual(location("home"));
    expect(parseInboundUrlIntent("/", {
      account: "profile", return: "evil", "add-money": "yes", flow: "withdraw", action: "not-an-id",
    }).location).toEqual(location("home"));
    expect(parseInboundUrlIntent("/save", new URLSearchParams("flow=save-deposit")).location).toEqual(location("cash", { cashView: "savings" }));
    expect(parseInboundUrlIntent("/home", new URLSearchParams("flow=save-deposit")).location).toEqual(location("home"));
  });
  test("allowlists every money flow and accepts action ids only for Send", () => {
    for (const flow of ["send", "add-money", "receive", "save-deposit", "save-withdraw"] as const) {
      expect(parseShellOverlayIntent(new URLSearchParams(`flow=${flow}`)).flow).toBe(flow);
    }
    expect(parseShellOverlayIntent(new URLSearchParams(`flow=receive&action=${ACTION_ID}`)).actionId).toBeNull();
    expect(parseShellOverlayIntent(new URLSearchParams(`flow=send&action=${ACTION_ID}`)).actionId).toBe(ACTION_ID);
  });
  test("keeps only allowlisted overlay intent on the verified home redirect", () => {
    expect(homeHrefWithOverlays(new URLSearchParams(
      `account=settings&flow=send&action=${ACTION_ID}&return=funding&add-money=1`,
    ))).toBe(`/home?account=settings&flow=send&action=${ACTION_ID}&return=funding&add-money=1`);
    expect(homeHrefWithOverlays(new URLSearchParams(
      "panel=balances&shelf=crypto&asset=cbbtc&group=investments&market=not-a-market&flow=withdraw",
    ))).toBe("/home");
    expect(homeHrefWithOverlays(new URLSearchParams())).toBe("/home");
  });
  test("redirects retired Save URLs with only validated overlay keys", () => {
    expect(legacyShellRedirectHref("/save/anything", new URLSearchParams(
      `flow=save-deposit&account=settings&return=funding&add-money=1&action=${ACTION_ID}&token=private`,
    ))).toBe("/cash/savings?flow=save-deposit&account=settings&return=funding&add-money=1");
    expect(legacyShellRedirectHref("/save", { flow: "save-withdraw", account: "nope", return: "bad" }))
      .toBe("/cash/savings?flow=save-withdraw");
    expect(legacyShellRedirectHref("/cash", new URLSearchParams("flow=save-deposit"))).toBeNull();
    expect(legacyShellRedirectHref("/saver", new URLSearchParams())).toBeNull();
  });
  test("recognizes the closed canonical shell route set", () => {
    for (const pathname of ["/home", "/cash", "/cash/savings", "/borrow/x", "/investments", "/investments/native", "/invest/cbbtc"]) {
      expect(isCanonicalShellPathname(pathname)).toBe(true);
    }
    for (const pathname of ["/", "/dashboard", "/account", "/fund", "/save", "/unknown", "/balancesx"]) {
      expect(isCanonicalShellPathname(pathname)).toBe(false);
    }
  });
  test("adds and removes only allowlisted flow state without URL payloads", () => {
    expect(flowHref("/cash", "send", null, new URLSearchParams("account=settings"))).toBe("/cash?account=settings&flow=send");
    expect(flowHref("/home", "send", ACTION_ID, new URLSearchParams())).toBe(`/home?flow=send&action=${ACTION_ID}`);
    expect(flowHref("/home", "receive", ACTION_ID, new URLSearchParams())).toBe("/home?flow=receive");
    expect(withoutFlowHref("/cash", new URLSearchParams(`flow=send&action=${ACTION_ID}`))).toBe("/cash");
    expect(withoutFlowHref("/cash", new URLSearchParams("return=funding&add-money=1&flow=send"))).toBe("/cash?return=funding&add-money=1");
  });
  test("serializes a server page's searchParams, including repeated keys", () => {
    expect(searchParamsToString({ account: "signin", flow: "send", tags: ["a", "b"], missing: undefined })).toBe("account=signin&flow=send&tags=a&tags=b");
    expect(searchParamsToString({})).toBe("");
  });
});
  test("reads and writes the in-app history origin from entry state", () => {
    const state: Record<string, unknown> = {};
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      history: {
        get state() { return state; },
        replaceState(next: Record<string, unknown>) { Object.assign(state, next); },
      },
    } });
    try {
      expect(readShellHistoryOrigin()).toBeNull();
      writeShellHistoryOrigin("/home");
      expect(readShellHistoryOrigin()).toBe("/home");
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else delete (globalThis as { window?: unknown }).window;
    }
  });
