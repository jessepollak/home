import { isShellPanelId, type ShellPanelId } from "./navigation";
import { getBorrowMarketRef, type BorrowMarketId } from "@/shared/borrowing/config";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";
import { erc20AssetKey, nativeAssetKey, type AssetKey } from "@/shared/balances/types";
import { isRecord } from "@/shared/guards";
import { INVEST_SEARCH_QUERY_MAX_LENGTH } from "@/shared/invest/contracts/search";

// The pathname selects pages; account, flow and asset search are ephemeral
// query overlays. Obsolete page-routing query keys never select a page.
export const SHELL_ACCOUNT_PARAM = "account";
export const SHELL_FLOW_PARAM = "flow";
export const SHELL_ACTION_PARAM = "action";
export const SHELL_SEARCH_PARAM = "search";

export type ShellAccount = "signin" | "settings";
export type ShellFlow =
  | "send"
  | "cash-out"
  | "add-money"
  | "receive"
  | "save-deposit"
  | "save-withdraw";

export type ShellLocation = {
  panel: ShellPanelId;
  account: ShellAccount | null;
  shelf: string | null;
  asset: string | null;
  market: BorrowMarketId | null;
  cashView?: "savings" | null;
  holding?: AssetKey | null;
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

// Reserved Invest category segments match before asset resolution, so they can
// never be parsed as asset ids. Kept as literals: `config/` may not import the
// client discover module that owns the shelf catalog.
const investCategories = new Set<string>(["stocks", "crypto", "memes"]);
const shellFlows = new Set<ShellFlow>([
  "send",
  "cash-out",
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
 * overlay intent identically on the server and on the client (no hydration mismatch).
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

function splitPathname(pathname: string): (string | null)[] {
  return pathname.split("/").filter((segment) => segment.length > 0).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return null;
    }
  });
}

export function parseShellAccount(
  value: string | null | undefined,
): ShellAccount | null {
  return value === "signin" || value === "settings" ? value : null;
}

export function readShellAccountParam(search: ShellSearchInput): ShellAccount | null {
  return parseShellAccount(readSearchValue(search, SHELL_ACCOUNT_PARAM));
}

function readSearchValue(search: ShellSearchInput, key: string) {
  if (search instanceof URLSearchParams) return search.get(key) ?? undefined;
  return firstQueryValue(search[key]);
}

function parseAsset(value: string | undefined): string | null {
  return value && resolveMarketPriceAssetIdentity(value) ? value : null;
}

function parseBorrowMarket(value: string | undefined): BorrowMarketId | null {
  return (value && getBorrowMarketRef(value)?.marketId) || null;
}

function parseShellFlow(value: string | undefined): ShellFlow | null {
  return value && shellFlows.has(value as ShellFlow) ? value as ShellFlow : null;
}

function emptyLocation(panel: ShellPanelId): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, market: null, cashView: null, holding: null };
}

/**
 * Parses only canonical route segments into page state. Exact L1 routes match
 * first; invalid or extra L2 segments fall back to their canonical parent,
 * unknown top-level segments (including the legacy `/dashboard`) fall back to
 * `/home`, and reserved Invest categories match before asset resolution.
 */
export function parseShellLocation(pathname: string): ShellLocation {
  const segments = splitPathname(pathname);
  if (segments.length === 0) return emptyLocation("home");
  const [first, second, ...extra] = segments;
  if (first === "save") return { ...emptyLocation("cash"), cashView: "savings" };
  if (first === null || !isShellPanelId(first)) return emptyLocation("home");
  if (second === undefined) return emptyLocation(first);
  // Reject extra path segments and malformed encodings to the canonical parent.
  if (extra.length > 0 || second === null) return emptyLocation(first);
  if (first === "borrow") {
    return { ...emptyLocation("borrow"), market: parseBorrowMarket(second) };
  }
  if (first === "cash") {
    return { ...emptyLocation("cash"), cashView: second === "savings" ? "savings" : null };
  }
  if (first === "investments") {
    return { ...emptyLocation("investments"), holding: parseHolding(second) };
  }
  if (first === "invest") {
    if (investCategories.has(second)) {
      return { ...emptyLocation("invest"), shelf: second };
    }
    return { ...emptyLocation("invest"), asset: parseAsset(second) };
  }
  // `/home` and `/activity` take no L2 segment; an unknown second
  // segment already fell back to the parent above.
  return emptyLocation(first);
}

/** @public preserves the tested legacy Save overlay redirect contract. */
export function legacyShellRedirectHref(pathname: string, search: ShellSearchInput): string | null {
  if (splitPathname(pathname)[0] !== "save") return null;
  return shellOverlayRedirectHref("/cash/savings", search);
}

export function shellOverlayRedirectHref(path: string, search: ShellSearchInput): string {
  const overlay = parseShellOverlayIntent(search);
  const params = new URLSearchParams();
  if (overlay.flow) params.set(SHELL_FLOW_PARAM, overlay.flow);
  if (overlay.account) params.set(SHELL_ACCOUNT_PARAM, overlay.account);
  if (overlay.actionId) params.set(SHELL_ACTION_PARAM, overlay.actionId);
  if (overlay.fundingReturn) params.set("return", overlay.fundingReturn);
  if (overlay.addMoney) params.set("add-money", "1");
  return `${path}${params.size ? `?${params}` : ""}`;
}

function parseHolding(segment: string): AssetKey | null {
  if (segment === "native") return nativeAssetKey();
  return /^0x[0-9a-f]{40}$/i.test(segment) ? erc20AssetKey(segment) : null;
}

export type ShellOverlayIntent = {
  search: string | null;
  account: ShellAccount | null;
  returnedFromFunding: boolean;
  fundingReturn: "funding" | "verification" | null;
  addMoney: boolean;
  flow: ShellFlow | null;
  actionId: string | null;
};

/** Reads only the allowlisted ephemeral overlay keys; never page state. */
export function parseShellOverlayIntent(
  search: ShellSearchInput,
): ShellOverlayIntent {
  const flow = parseShellFlow(readSearchValue(search, SHELL_FLOW_PARAM));
  const action = readSearchValue(search, SHELL_ACTION_PARAM);
  const returnValue = readSearchValue(search, "return");
  const fundingReturn = returnValue === "funding" || returnValue === "verification" ? returnValue : null;
  const searchQuery = readSearchValue(search, SHELL_SEARCH_PARAM);
  return {
    search: searchQuery === undefined ? null : searchQuery.slice(0, INVEST_SEARCH_QUERY_MAX_LENGTH),
    account: readShellAccountParam(search),
    returnedFromFunding: fundingReturn !== null,
    fundingReturn,
    addMoney: readSearchValue(search, "add-money") === "1",
    flow,
    actionId: (flow === "send" || flow === "cash-out") && action && actionIdPattern.test(action) ? action : null,
  };
}

/** @public exercised by config/shell-location.test.ts */
export function parseInboundUrlIntent(
  pathname: string,
  search: ShellSearchInput,
): InboundUrlIntent {
  const overlay = parseShellOverlayIntent(search);
  return {
    kind: "inbound-url-intent",
    location: { ...parseShellLocation(pathname), account: overlay.account },
    returnedFromFunding: overlay.returnedFromFunding,
    addMoney: overlay.addMoney,
    flow: overlay.flow,
    actionId: overlay.actionId,
  };
}

/**
 * Emits the canonical pathname for a shell location plus its account overlay.
 * No page-routing query keys are ever emitted.
 */
export function shellHref(location: Partial<ShellLocation> = {}): string {
  const panel = location.panel ?? "home";
  let pathname = `/${panel}`;
  if (panel === "cash" && location.cashView === "savings") pathname += "/savings";
  if (panel === "borrow" && location.market) {
    const configuredMarket = getBorrowMarketRef(location.market);
    if (configuredMarket) pathname += `/${configuredMarket.marketId}`;
  }
  if (panel === "investments" && location.holding) {
    if (location.holding === nativeAssetKey()) pathname += "/native";
    else {
      const address = location.holding.split("/erc20:")[1];
      if (address && /^0x[0-9a-f]{40}$/i.test(address)) pathname += `/${address.toLowerCase()}`;
    }
  }
  if (panel === "invest") {
    // One L2 segment: a flat asset path wins; categories are only emitted alone.
    if (location.asset) pathname += `/${location.asset}`;
    else if (location.shelf) pathname += `/${location.shelf}`;
  }
  const params = new URLSearchParams();
  if (location.account) params.set(SHELL_ACCOUNT_PARAM, location.account);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
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
  if ((flow === "send" || flow === "cash-out") && actionId && actionIdPattern.test(actionId)) {
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

/** The closed set of canonical shell routes the in-shell overlays commit to. */
export function isCanonicalShellPathname(pathname: string): boolean {
  const first = pathname.split("/").filter((segment) => segment.length > 0)[0];
  return first !== undefined && isShellPanelId(first);
}

/**
 * `/home` carrying only allowlisted ephemeral overlay intent; obsolete
 * page-routing query keys and malformed values never survive the verified
 * root redirect. Callers keep `/?account=signin` at the root themselves.
 */
export function homeHrefWithOverlays(search: ShellSearchInput): string {
  const overlay = parseShellOverlayIntent(search);
  const params = new URLSearchParams();
  if (overlay.account) params.set(SHELL_ACCOUNT_PARAM, overlay.account);
  if (overlay.flow) params.set(SHELL_FLOW_PARAM, overlay.flow);
  if (overlay.actionId) params.set(SHELL_ACTION_PARAM, overlay.actionId);
  if (overlay.fundingReturn) params.set("return", overlay.fundingReturn);
  if (overlay.addMoney) params.set("add-money", "1");
  const query = params.toString();
  return query ? `/home?${query}` : "/home";
}

export type ShellHistoryFlag = "fundingFlowPushed" | "cashSavingsFlowPushed";

const shellHistoryFlagKeys: Record<ShellHistoryFlag, string> = {
  fundingFlowPushed: "__homeFundingFlowPushed",
  cashSavingsFlowPushed: "__cashSavingsFlowPushed",
};

export function readClientHistoryFlag(
  flag: ShellHistoryFlag,
  state: unknown = typeof window === "undefined" ? null : window.history.state,
): boolean {
  return isRecord(state) && state[shellHistoryFlagKeys[flag]] === true;
}

export function backClientHistory(): void {
  if (typeof window === "undefined") return;
  window.history.back();
}

const SHELL_ORIGIN_STATE_KEY = "__homeShellOrigin";

/**
 * The pathname this history entry was pushed from inside the app. Used to
 * decide whether the shell Back control can reuse the existing entry instead
 * of pushing a duplicate parent entry. Read from `history.state`, so it
 * survives reload, Back and Forward.
 */
export function readShellHistoryOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const state = window.history.state as Record<string, unknown> | null;
  const value = state?.[SHELL_ORIGIN_STATE_KEY];
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

export function writeShellHistoryOrigin(origin: string): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({ ...window.history.state, [SHELL_ORIGIN_STATE_KEY]: origin }, "");
}

export function commitClientUrl(
  href: string,
  mode: "push" | "replace" = "push",
  extraState?: Record<string, unknown>,
  notifyRouter = false,
): void {
  if (typeof window === "undefined") return;
  const currentState: unknown = window.history.state;
  const state = { ...(isRecord(currentState) ? currentState : {}), ...extraState };
  if (notifyRouter) { delete state.__NA; delete state._N; }
  if (mode === "replace") {
    window.history.replaceState(notifyRouter ? state : extraState
      ? { ...window.history.state, ...extraState } : window.history.state, "", href);
  } else {
    window.history.pushState(state, "", href);
  }
}

export function commitFlowUrl(
  href: string,
  mode: "push" | "replace" = "push",
): boolean {
  if (typeof window === "undefined") return false;
  const current = `${window.location.pathname}${window.location.search}`;
  const target = new URL(href, window.location.origin);
  const unchanged = `${target.pathname}${target.search}` === current;
  const pushed = mode === "push" && !unchanged;
  commitClientUrl(href, pushed ? "push" : "replace");
  return pushed;
}
