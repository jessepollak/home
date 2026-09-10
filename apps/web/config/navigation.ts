export const navigationItems = [
  { id: "home", label: "Home" },
  { id: "invest", label: "Invest" },
] as const;

export const savePanelId = "save" as const;
export const balancesPanelId = "balances" as const;
export const activityPanelId = "activity" as const;

export const homeNestedPanelIds = [
  savePanelId,
  balancesPanelId,
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
): "Balances" | "Activity" | null {
  if (panel === balancesPanelId) return "Balances";
  if (panel === activityPanelId) return "Activity";
  return null;
}
