import { describe, expect, test } from "bun:test";
import { BORROW_MARKET_ID } from "@/shared/borrowing/config";
import {
  flowHref,
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
  ["/invest/stocks", location("invest", { shelf: "stocks" })],
  ["/invest/crypto", location("invest", { shelf: "crypto" })],
  ["/invest/memes", location("invest", { shelf: "memes" })],
  ["/invest/cbbtc", location("invest", { asset: "cbbtc" })],
  [`/invest/${DYNAMIC_ASSET_ID}`, location("invest", { asset: DYNAMIC_ASSET_ID })],
];

describe("shell location", () => {
  test("round-trips every canonical L1 and L2 path", () => {
    for (const [pathname, expected] of canonicalLocations) {
      expect(parseShellLocation(pathname)).toEqual(expected);
      expect(parseShellLocation(shellHref(expected))).toEqual(expected);
    }
  });

  test("parses encoded dynamic asset segments once", () => {
    expect(parseShellLocation(`/invest/${encodeURIComponent(DYNAMIC_ASSET_ID)}`))
      .toEqual(location("invest", { asset: DYNAMIC_ASSET_ID }));
  });

  test("falls back to /home for the root, the legacy dashboard, and unknown segments", () => {
    const fallbacks = ["/", "/dashboard", "/unknown", "/dashboard/panel", "/%zz"];
    for (const pathname of fallbacks) {
      expect(parseShellLocation(pathname)).toEqual(location("home"));
    }
  });

  test("falls back to the canonical parent for invalid or extra L2 segments", () => {
    const fallbacks = [
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
    ] as const;
    for (const [pathname, expected] of fallbacks) {
      expect(parseShellLocation(pathname)).toEqual(expected);
    }
  });

  test("matches reserved Invest categories before asset resolution", () => {
    // The category names are not asset ids, but the parser must not even reach
    // asset resolution for them.
    for (const category of ["stocks", "crypto", "memes"]) {
      expect(parseShellLocation(`/invest/${category}`))
        .toEqual(location("invest", { shelf: category }));
    }
  });

  test("emits canonical pathnames and never page-routing query keys", () => {
    const cases = [
      [{}, "/home"],
      [{ panel: "save" as const }, "/save"],
      [{ panel: "balances" as const, group: "cash" as const }, "/balances/cash"],
      [{ panel: "invest" as const, shelf: "stocks" }, "/invest/stocks"],
      [
        { panel: "borrow" as const, market: BORROW_MARKET_ID },
        `/borrow/${BORROW_MARKET_ID}`,
      ],
      [{ account: "settings" as const }, "/home?account=settings"],
      [
        { panel: "balances" as const, group: "cash" as const, account: "settings" as const },
        "/balances/cash?account=settings",
      ],
    ] as const;
    for (const [location_, expected] of cases) {
      expect(shellHref(location_)).toBe(expected);
    }
    // A flat asset path wins over the local category context: one L2 segment.
    expect(shellHref({ panel: "invest", asset: "cbbtc", shelf: "crypto" })).toBe("/invest/cbbtc");
    // Unconfigured markets emit the parent path.
    expect(shellHref({ panel: "borrow", market: `0x${"ff".repeat(32)}` })).toBe("/borrow");
  });

  test("combines pathname page state with allowlisted overlay query state", () => {
    expect(parseInboundUrlIntent("/balances", new URLSearchParams(
      "account=settings&flow=send&action=11111111-1111-4111-8111-111111111111&return=funding&add-money=1",
    ))).toEqual({
      kind: "inbound-url-intent",
      location: location("balances", { account: "settings" }),
      returnedFromFunding: true,
      addMoney: true,
      flow: "send",
      actionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("never lets obsolete or malformed query values select a page", () => {
    const obsolete = parseInboundUrlIntent("/home", new URLSearchParams(
      "panel=balances&shelf=crypto&asset=cbbtc&group=investments&market=not-a-market",
    ));
    expect(obsolete.location).toEqual(location("home", { account: null }));
    expect(parseInboundUrlIntent("/", {
      account: "profile",
      return: "evil",
      "add-money": "yes",
      flow: "withdraw",
      action: "not-an-id",
    }).location).toEqual(location("home"));
  });

  test("allowlists every addressable money flow and accepts action ids only for Send", () => {
    const flows = ["send", "add-money", "receive", "save-deposit", "save-withdraw"] as const;
    for (const flow of flows) {
      const overlay = parseShellOverlayIntent(new URLSearchParams(`flow=${flow}`));
      expect(overlay.flow).toBe(flow);
    }
    expect(parseShellOverlayIntent(new URLSearchParams(
      "flow=receive&action=11111111-1111-4111-8111-111111111111",
    )).actionId).toBeNull();
    expect(parseShellOverlayIntent(new URLSearchParams(
      "flow=send&action=11111111-1111-4111-8111-111111111111",
    )).actionId).toBe("11111111-1111-4111-8111-111111111111");
  });

  test("keeps save flows as overlays without panel coercion", () => {
    // Overlay query parsing must never reintroduce page selection: the flow
    // opens on whatever canonical page the pathname selects.
    expect(parseInboundUrlIntent("/save", new URLSearchParams("flow=save-deposit")).location.panel)
      .toBe("save");
    expect(parseInboundUrlIntent("/home", new URLSearchParams("flow=save-deposit")).location.panel)
      .toBe("home");
  });

  test("recognizes the closed canonical shell route set", () => {
    const canonical = ["/home", "/balances", "/balances/cash", "/borrow/x", "/invest/cbbtc"];
    for (const pathname of canonical) expect(isCanonicalShellPathname(pathname)).toBe(true);
    const outside = ["/", "/dashboard", "/account", "/fund", "/unknown", "/balancesx"];
    for (const pathname of outside) expect(isCanonicalShellPathname(pathname)).toBe(false);
  });
});

describe("money flow location", () => {
  test("adds and removes only allowlisted flow state without URL payloads", () => {
    const overlays = new URLSearchParams("account=settings");
    expect(flowHref("/balances", "send", null, overlays)).toBe(
      "/balances?account=settings&flow=send",
    );
    expect(flowHref(
      "/home",
      "send",
      "11111111-1111-4111-8111-111111111111",
      new URLSearchParams(),
    )).toBe("/home?flow=send&action=11111111-1111-4111-8111-111111111111");
    expect(flowHref(
      "/home",
      "receive",
      "11111111-1111-4111-8111-111111111111",
      new URLSearchParams(),
    )).toBe("/home?flow=receive");
    expect(withoutFlowHref(
      "/balances/cash",
      new URLSearchParams("flow=send&action=11111111-1111-4111-8111-111111111111"),
    )).toBe("/balances/cash");
    // Non-flow overlay keys survive a flow removal.
    expect(withoutFlowHref(
      "/balances",
      new URLSearchParams("return=funding&add-money=1&flow=send"),
    )).toBe("/balances?return=funding&add-money=1");
  });
});

describe("searchParamsToString", () => {
  test("serializes a server page's searchParams, including repeated keys", () => {
    expect(searchParamsToString({ account: "signin", flow: "send", tags: ["a", "b"], missing: undefined }))
      .toBe("account=signin&flow=send&tags=a&tags=b");
    expect(searchParamsToString({})).toBe("");
  });
});
