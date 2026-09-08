import { isShellPanelId, type ShellPanelId } from "./navigation";

export const SHELL_PANEL_PARAM = "panel";
export const SHELL_ACCOUNT_PARAM = "account";
export const SHELL_SHELF_PARAM = "shelf";
export const SHELL_ASSET_PARAM = "asset";

export type ShellAccount = "signin" | "settings";

export type ShellLocation = {
  panel: ShellPanelId;
  account: ShellAccount | null;
  shelf: string | null;
  asset: string | null;
};

export type ShellSearchInput = URLSearchParams | Record<
  string,
  string | string[] | undefined
>;

export function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseShellAccount(
  value: string | null | undefined,
): ShellAccount | null {
  return value === "signin" || value === "settings" ? value : null;
}

export function parseShellPanel(
  value: string | null | undefined,
): ShellPanelId {
  return value && isShellPanelId(value) ? value : "home";
}

function readSearchValue(search: ShellSearchInput, key: string) {
  if (search instanceof URLSearchParams) return search.get(key) ?? undefined;
  return firstQueryValue(search[key]);
}

export function parseShellLocation(search: ShellSearchInput): ShellLocation {
  const panel = parseShellPanel(readSearchValue(search, SHELL_PANEL_PARAM));
  return {
    panel,
    account: parseShellAccount(readSearchValue(search, SHELL_ACCOUNT_PARAM)),
    shelf: panel === "invest" ? readSearchValue(search, SHELL_SHELF_PARAM) ?? null : null,
    asset: panel === "invest" ? readSearchValue(search, SHELL_ASSET_PARAM) ?? null : null,
  };
}

export function shellHref(
  path: string,
  {
    panel = "home",
    account = null,
    shelf = null,
    asset = null,
  }: Partial<ShellLocation> = {},
): string {
  const params = new URLSearchParams();
  if (panel !== "home") params.set(SHELL_PANEL_PARAM, panel);
  if (account) params.set(SHELL_ACCOUNT_PARAM, account);
  if (panel === "invest") {
    if (shelf) params.set(SHELL_SHELF_PARAM, shelf);
    if (asset) params.set(SHELL_ASSET_PARAM, asset);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
