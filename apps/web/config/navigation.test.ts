import { describe, expect, test } from "bun:test";
import {
  activityPanelId,
  balancesPanelId,
  isHomeNestedPanelId,
  isNavigationId,
  isShellPanelId,
  navigationItems,
  nestedHomePanelTitle,
  savePanelId,
} from "./navigation";

describe("primary navigation", () => {
  test("keeps the bounded Home, Invest tab order", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Home",
      "Invest",
    ]);
  });

  test("accepts only configured tab destinations", () => {
    expect(isNavigationId("home")).toBe(true);
    expect(isNavigationId("invest")).toBe(true);
    expect(isNavigationId("save")).toBe(false);
    expect(isNavigationId("explore")).toBe(false);
  });

  test("keeps Save, Balances, and Activity as Home teaser destinations, not tabs", () => {
    expect(savePanelId).toBe("save");
    expect(balancesPanelId).toBe("balances");
    expect(activityPanelId).toBe("activity");
    expect(isNavigationId("balances")).toBe(false);
    expect(isNavigationId("activity")).toBe(false);
    expect(isHomeNestedPanelId("save")).toBe(true);
    expect(isHomeNestedPanelId("balances")).toBe(true);
    expect(isHomeNestedPanelId("activity")).toBe(true);
    expect(isHomeNestedPanelId("home")).toBe(false);
    expect(isShellPanelId("save")).toBe(true);
    expect(isShellPanelId("balances")).toBe(true);
    expect(isShellPanelId("activity")).toBe(true);
    expect(isShellPanelId("home")).toBe(true);
    expect(isShellPanelId("explore")).toBe(false);
    expect(nestedHomePanelTitle("balances")).toBe("Balances");
    expect(nestedHomePanelTitle("activity")).toBe("Activity");
    expect(nestedHomePanelTitle("save")).toBeNull();
    expect(nestedHomePanelTitle("home")).toBeNull();
  });
});
