import { describe, expect, test } from "bun:test";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import {
  flowHref,
  homeHrefWithOverlays,
  isCanonicalShellPathname,
  parseInboundUrlIntent,
  parseShellLocation,
  parseShellOverlayIntent,
  searchParamsToString,
  shellHref,
  withoutFlowHref,
  type ShellLocation,
} from "./shell-location";

const DYNAMIC_ASSET_ID = "base:0x1111111111111111111111111111111111111111";
const ACTION_ID = "11111111-1111-4111-8111-111111111111";

function location(panel: ShellLocation["panel"], rest: Partial<ShellLocation> = {}): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, group: null, market: null, ...rest };
}

const canonicalLocations: Array<[string, ShellLocation]> = [
  ["/home", location("home")],
  ["/balances", location("balances")],
  ["/balances/cash", location("balances", { group: "cash" })],
  ["/balances/investments", location("balances", { group: "investments" })],
  ["/activity", location("activity")],
  ["/save", location("save")],
  ["/borrow", location("borrow")],
  [`/borrow/${BORROW_MARKET_ID}`, location("borrow", { market: BORROW_MARKET_ID })],
  ["/invest", location("invest")],
  // Reserved categories and assets share one flat L2 segment; categories match first.
  ["/invest/stocks", location("invest", { shelf: "stocks" })],
  ["/invest/crypto", location("invest", { shelf: "crypto" })],
  ["/invest/memes", location("invest", { shelf: "memes" })],
  ["/invest/cbbtc", location("invest", { asset: "cbbtc" })],
  [`/invest/${DYNAMIC_ASSET_ID}`, location("invest", { asset: DYNAMIC_ASSET_ID })],
  [`/invest/${encodeURIComponent(DYNAMIC_ASSET_ID)}`, location("invest", { asset: DYNAMIC_ASSET_ID })],
];

const fallbackLocations: Array<[string, ShellLocation]> = [
  // Root, the legacy dashboard, unknown top-level segments, and malformed encodings → /home.
  ["/", location("home")],
  ["/dashboard", location("home")],
  ["/unknown", location("home")],
  ["/dashboard/panel", location("home")],
  ["/%zz", location("home")],
  // Invalid or extra L2 segments → the canonical parent.
  ["/balances/grocery", location("balances")],
  ["/balances/cash/extra", location("balances")],
  ["/borrow/not-a-market", location("borrow")],
  [`/borrow/0x${"ff".repeat(32)}`, location("borrow")],
  ["/invest/forex", location("invest")],
  ["/invest/not-an-asset", location("invest")],
  ["/invest/base:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", location("invest")],
  ["/home/nope", location("home")],
  ["/save/nope", location("save")],
  ["/activity/nope", location("activity")],
];

describe("shell location", () => {
  test("round-trips every canonical L1 and L2 path through the parser", () => {
    for (const [pathname, expected] of canonicalLocations) {
      expect(parseShellLocation(pathname)).toEqual(expected);
      expect(parseShellLocation(shellHref(expected))).toEqual(expected);
    }
  });

  test("falls back to /home or the canonical parent for non-canonical paths", () => {
    for (const [pathname, expected] of fallbackLocations) {
      expect(parseShellLocation(pathname)).toEqual(expected);
    }
  });

  test("emits canonical pathnames and never page-routing query keys", () => {
    const cases = [
      [{}, "/home"],
      [{ panel: "save" as const }, "/save"],
      [{ panel: "balances" as const, group: "cash" as const }, "/balances/cash"],
      [{ panel: "invest" as const, shelf: "stocks" }, "/invest/stocks"],
      [{ panel: "borrow" as const, market: BORROW_MARKET_ID }, `/borrow/${BORROW_MARKET_ID}`],
      [{ account: "settings" as const }, "/home?account=settings"],
      [{ panel: "balances" as const, group: "cash" as const, account: "settings" as const }, "/balances/cash?account=settings"],
      // A flat asset path wins over the local category context: one L2 segment.
      [{ panel: "invest" as const, asset: "cbbtc", shelf: "crypto" }, "/invest/cbbtc"],
      // Unconfigured markets emit the parent path.
      [{ panel: "borrow" as const, market: `0x${"ff".repeat(32)}` }, "/borrow"],
    ] as const;
    for (const [location_, expected] of cases) {
      expect(shellHref(location_)).toBe(expected);
    }
  });

  test("combines pathname page state with allowlisted overlay query state", () => {
    expect(parseInboundUrlIntent("/balances", new URLSearchParams(
      `account=settings&flow=send&action=${ACTION_ID}&return=funding&add-money=1`,
    ))).toEqual({
      kind: "inbound-url-intent",
      location: location("balances", { account: "settings" }),
      returnedFromFunding: true,
      addMoney: true,
      flow: "send",
      actionId: ACTION_ID,
    });
  });

  test("never lets obsolete, malformed, or misplaced query values select a page or open flows", () => {
    expect(parseInboundUrlIntent("/home", new URLSearchParams(
      "panel=balances&shelf=crypto&asset=cbbtc&group=investments&market=not-a-market",
    )).location).toEqual(location("home"));
    expect(parseInboundUrlIntent("/", {
      account: "profile", return: "evil", "add-money": "yes", flow: "withdraw", action: "not-an-id",
    }).location).toEqual(location("home"));
    // Save flows stay overlays: no panel coercion anywhere.
    expect(parseInboundUrlIntent("/save", new URLSearchParams("flow=save-deposit")).location)
      .toEqual(location("save"));
    expect(parseInboundUrlIntent("/home", new URLSearchParams("flow=save-deposit")).location)
      .toEqual(location("home"));
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
    // Obsolete page-routing params and malformed values never survive.
    expect(homeHrefWithOverlays(new URLSearchParams(
      "panel=balances&shelf=crypto&asset=cbbtc&group=investments&market=not-a-market&flow=withdraw",
    ))).toBe("/home");
    expect(homeHrefWithOverlays(new URLSearchParams())).toBe("/home");
  });

  test("recognizes the closed canonical shell route set", () => {
    for (const pathname of ["/home", "/balances", "/balances/cash", "/borrow/x", "/invest/cbbtc"]) {
      expect(isCanonicalShellPathname(pathname)).toBe(true);
    }
    for (const pathname of ["/", "/dashboard", "/account", "/fund", "/unknown", "/balancesx"]) {
      expect(isCanonicalShellPathname(pathname)).toBe(false);
    }
  });

  test("adds and removes only allowlisted flow state without URL payloads", () => {
    expect(flowHref("/balances", "send", null, new URLSearchParams("account=settings"))).toBe(
      "/balances?account=settings&flow=send",
    );
    expect(flowHref("/home", "send", ACTION_ID, new URLSearchParams()))
      .toBe(`/home?flow=send&action=${ACTION_ID}`);
    expect(flowHref("/home", "receive", ACTION_ID, new URLSearchParams())).toBe("/home?flow=receive");
    expect(withoutFlowHref("/balances/cash", new URLSearchParams(`flow=send&action=${ACTION_ID}`)))
      .toBe("/balances/cash");
    // Non-flow overlay keys survive a flow removal.
    expect(withoutFlowHref("/balances", new URLSearchParams("return=funding&add-money=1&flow=send")))
      .toBe("/balances?return=funding&add-money=1");
  });

  test("serializes a server page's searchParams, including repeated keys", () => {
    expect(searchParamsToString({ account: "signin", flow: "send", tags: ["a", "b"], missing: undefined }))
      .toBe("account=signin&flow=send&tags=a&tags=b");
    expect(searchParamsToString({})).toBe("");
  });
});
