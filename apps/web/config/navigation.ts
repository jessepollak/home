export const navigationItems = [
  { id: "home", label: "Home" },
  { id: "card", label: "Card" },
  { id: "invest", label: "Invest" },
] as const;

export function visibleNavigationItems({ cardsEnabled }: { cardsEnabled: boolean }) {
  return navigationItems.filter((item) => item.id !== "card" || cardsEnabled);
}

export const cashPanelId = "cash" as const;
export const borrowPanelId = "borrow" as const;
export const investmentsPanelId = "investments" as const;
export const activityPanelId = "activity" as const;

export const homeNestedPanelIds = [
  cashPanelId,
  borrowPanelId,
  investmentsPanelId,
  activityPanelId,
] as const;

export type NavigationId = (typeof navigationItems)[number]["id"];
export type HomeNestedPanelId = (typeof homeNestedPanelIds)[number];
export type ShellPanelId = NavigationId | HomeNestedPanelId;

export function isNavigationId(value: string): value is NavigationId {
  return navigationItems.some((item) => item.id === value);
}

export function isHomeNestedPanelId(value: string): value is HomeNestedPanelId {
  return (homeNestedPanelIds as readonly string[]).includes(value);
}

export function isShellPanelId(value: string): value is ShellPanelId {
  return isNavigationId(value) || isHomeNestedPanelId(value);
}

export function nestedHomePanelTitle(
  panel: ShellPanelId,
): "Activity" | "Borrow" | "Cash" | "Investments" | null {
  if (panel === activityPanelId) return "Activity";
  if (panel === borrowPanelId) return "Borrow";
  if (panel === cashPanelId) return "Cash";
  if (panel === investmentsPanelId) return "Investments";
  return null;
}
