import { describe, expect, test } from "bun:test";
import {
  isNavigationId,
  isShellPanelId,
  navigationItems,
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

  test("keeps Save as a Home teaser destination, not a tab", () => {
    expect(savePanelId).toBe("save");
    expect(isShellPanelId("save")).toBe(true);
    expect(isShellPanelId("home")).toBe(true);
    expect(isShellPanelId("explore")).toBe(false);
  });
});
