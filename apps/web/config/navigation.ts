export const navigationItems = [
  { id: "home", label: "Home" },
  { id: "invest", label: "Invest" },
] as const;

export const savePanelId = "save" as const;

export type NavigationId = (typeof navigationItems)[number]["id"];
export type ShellPanelId = NavigationId | typeof savePanelId;

export function isNavigationId(value: string): value is NavigationId {
  return navigationItems.some((item) => item.id === value);
}

export function isShellPanelId(value: string): value is ShellPanelId {
  return isNavigationId(value) || value === savePanelId;
}
