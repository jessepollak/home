import { isShellPanelId, type ShellPanelId } from "./navigation";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/history-contract";

export const SHELL_PANEL_PARAM = "panel";
export const SHELL_ACCOUNT_PARAM = "account";
export const SHELL_SHELF_PARAM = "shelf";
export const SHELL_ASSET_PARAM = "asset";
export const SHELL_FLOW_PARAM = "flow";
export const SHELL_ACTION_PARAM = "action";

export type ShellAccount = "signin" | "settings";
export type ShellFlow =
  | "send"
  | "add-money"
  | "receive"
  | "save-deposit"
  | "save-withdraw";

export type ShellLocation = {
  panel: ShellPanelId;
  account: ShellAccount | null;
  shelf: string | null;
  asset: string | null;
};

export type InboundUrlIntent = {
  kind: "inbound-url-intent";
  location: ShellLocation;
  returnedFromFunding: boolean;
  addMoney: boolean;
  flow: ShellFlow | null;
  actionId: string | null;
};

export type ShellSearchInput = URLSearchParams | Record<
  string,
  string | string[] | undefined
>;

const discoverShelfIds = new Set(["stocks", "crypto", "memes"]);
const shellFlows = new Set<ShellFlow>([
  "send",
  "add-money",
  "receive",
  "save-deposit",
  "save-withdraw",
]);
const actionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Serializes a server page's `searchParams` so the shell can derive its initial
 * URL intent identically on the server and on the client (no hydration mismatch).
 */
export function searchParamsToString(
  query: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      search.append(key, item);
    }
  }
  return search.toString();
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

function parseShelf(value: string | undefined): string | null {
  return value && discoverShelfIds.has(value) ? value : null;
}

function parseAsset(value: string | undefined): string | null {
  return value && resolveMarketPriceAssetIdentity(value) ? value : null;
}

function parseShellFlow(value: string | undefined): ShellFlow | null {
  return value && shellFlows.has(value as ShellFlow) ? value as ShellFlow : null;
}

export function parseInboundUrlIntent(
  search: ShellSearchInput,
): InboundUrlIntent {
  const flow = parseShellFlow(readSearchValue(search, SHELL_FLOW_PARAM));
  const requestedPanel = readSearchValue(search, SHELL_PANEL_PARAM);
  // Save flows always live on the Save panel: the dialog renders in place, so it
  // must not open inside another (hidden, inert) panel.
  const panel = flow === "save-deposit" || flow === "save-withdraw"
    ? "save"
    : parseShellPanel(requestedPanel);
  const action = readSearchValue(search, SHELL_ACTION_PARAM);
  return {
    kind: "inbound-url-intent",
    location: {
      panel,
      account: parseShellAccount(readSearchValue(search, SHELL_ACCOUNT_PARAM)),
      shelf: panel === "invest"
        ? parseShelf(readSearchValue(search, SHELL_SHELF_PARAM))
        : null,
      asset: panel === "invest"
        ? parseAsset(readSearchValue(search, SHELL_ASSET_PARAM))
        : null,
    },
    returnedFromFunding: readSearchValue(search, "return") === "funding",
    addMoney: readSearchValue(search, "add-money") === "1",
    flow,
    actionId: flow === "send" && action && actionIdPattern.test(action) ? action : null,
  };
}

export function parseShellLocation(search: ShellSearchInput): ShellLocation {
  return parseInboundUrlIntent(search).location;
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

export function flowHref(
  path: string,
  flow: ShellFlow,
  actionId: string | null = null,
  search?: URLSearchParams,
): string {
  const current = search
    ? new URL(`${path}?${search}`, "https://home.invalid")
    : typeof window === "undefined"
      ? new URL(path, "https://home.invalid")
      : new URL(window.location.href);
  current.pathname = path;
  current.searchParams.set(SHELL_FLOW_PARAM, flow);
  if (flow === "send" && actionId && actionIdPattern.test(actionId)) {
    current.searchParams.set(SHELL_ACTION_PARAM, actionId);
  } else {
    current.searchParams.delete(SHELL_ACTION_PARAM);
  }
  return `${current.pathname}${current.search}`;
}

export function withoutFlowHref(
  path: string,
  search?: URLSearchParams,
): string {
  const current = search
    ? new URL(`${path}?${search}`, "https://home.invalid")
    : typeof window === "undefined"
      ? new URL(path, "https://home.invalid")
      : new URL(window.location.href);
  current.pathname = path;
  current.searchParams.delete(SHELL_FLOW_PARAM);
  current.searchParams.delete(SHELL_ACTION_PARAM);
  return `${current.pathname}${current.search}`;
}

export function commitClientUrl(
  href: string,
  mode: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;
  if (mode === "replace") {
    window.history.replaceState(window.history.state, "", href);
  } else {
    window.history.pushState(window.history.state, "", href);
  }
}
