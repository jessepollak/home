import { describe, expect, test } from "bun:test";
import { parseShellLocation } from "@/config/shell-location";
import { DEFAULT_BORROW_MARKET } from "@/shared/borrowing/config";
import { panelFocusKey } from "./navigation-focus";

describe("panel focus key", () => {
  test("moves focus for every panel and location change it names", () => {
    const home = parseShellLocation("/home");
    const keys = new Set([
      panelFocusKey("home", home),
      panelFocusKey("invest", home),
      panelFocusKey("home", { ...home, shelf: "crypto" }),
      panelFocusKey("home", { ...home, asset: "eip155:8453/native" }),
      panelFocusKey("home", { ...home, group: "cash" }),
      panelFocusKey("home", { ...home, market: DEFAULT_BORROW_MARKET.marketId }),
      panelFocusKey("home", { ...home, cashView: "savings" }),
      panelFocusKey("home", { ...home, holding: "eip155:8453/native" }),
    ]);
    expect(keys.size).toBe(8);
  });
});
