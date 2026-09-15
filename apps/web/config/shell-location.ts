import { isShellPanelId, type ShellPanelId } from "./navigation";
import { getBorrowMarketRef, type BorrowMarketId } from "@/shared/borrowing/config";
import { resolveMarketPriceAssetIdentity } from "@/shared/invest/contracts/market-price-history";

// The pathname is authoritative for page state. Only the ephemeral account and
// flow overlays below may appear as query keys; obsolete `panel`, `shelf`,
// `asset`, `group`, and `market` query values never select a page.
export const SHELL_ACCOUNT_PARAM = "account";
export const SHELL_FLOW_PARAM = "flow";
export const SHELL_ACTION_PARAM = "action";

export type ShellAccount = "signin" | "settings";
export type MoneyGroupId = "cash" | "investments";
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
  group: MoneyGroupId | null;
  market: BorrowMarketId | null;
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
const moneyGroups = new Set<MoneyGroupId>(["cash", "investments"]);
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

function parseMoneyGroup(value: string | undefined): MoneyGroupId | null {
  return value && moneyGroups.has(value as MoneyGroupId) ? value as MoneyGroupId : null;
}

function parseBorrowMarket(value: string | undefined): BorrowMarketId | null {
  return (value && getBorrowMarketRef(value)?.marketId) || null;
}

function parseShellFlow(value: string | undefined): ShellFlow | null {
  return value && shellFlows.has(value as ShellFlow) ? value as ShellFlow : null;
}

function emptyLocation(panel: ShellPanelId): ShellLocation {
  return { panel, account: null, shelf: null, asset: null, group: null, market: null };
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
  if (first === null || !isShellPanelId(first)) return emptyLocation("home");
  if (second === undefined) return emptyLocation(first);
  // Reject extra path segments and malformed encodings to the canonical parent.
  if (extra.length > 0 || second === null) return emptyLocation(first);
  if (first === "balances") {
    return { ...emptyLocation("balances"), group: parseMoneyGroup(second) };
  }
  if (first === "borrow") {
    return { ...emptyLocation("borrow"), market: parseBorrowMarket(second) };
  }
  if (first === "invest") {
    if (investCategories.has(second)) {
      return { ...emptyLocation("invest"), shelf: second };
    }
    return { ...emptyLocation("invest"), asset: parseAsset(second) };
  }
  // `/home`, `/save`, and `/activity` take no L2 segment; an unknown second
  // segment already fell back to the parent above.
  return emptyLocation(first);
}

export type ShellOverlayIntent = {
  account: ShellAccount | null;
  returnedFromFunding: boolean;
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
  return {
    account: readShellAccountParam(search),
    returnedFromFunding: readSearchValue(search, "return") === "funding",
    addMoney: readSearchValue(search, "add-money") === "1",
    flow,
    actionId: flow === "send" && action && actionIdPattern.test(action) ? action : null,
  };
}

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
  if (panel === "balances" && location.group) pathname += `/${location.group}`;
  if (panel === "borrow" && location.market) {
    const configuredMarket = getBorrowMarketRef(location.market);
    if (configuredMarket) pathname += `/${configuredMarket.marketId}`;
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
  if (overlay.returnedFromFunding) params.set("return", "funding");
  if (overlay.addMoney) params.set("add-money", "1");
  const query = params.toString();
  return query ? `/home?${query}` : "/home";
}

const SHELL_SCROLL_TOP_STATE_KEY = "__homeShellScrollTop";
const SHELL_CLIENT_ENTRY_STATE_KEY = "__homeShellClientEntry";
const beforeClientUrlCommitListeners = new Set<() => void>();

function historyStateWithScrollTop(state: unknown, scrollTop: number): Record<string, unknown> {
  const current = state && typeof state === "object" ? state as Record<string, unknown> : {};
  return { ...current, [SHELL_SCROLL_TOP_STATE_KEY]: Math.max(0, scrollTop) };
}

export function readClientScrollTop(state: unknown = window.history.state): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[SHELL_SCROLL_TOP_STATE_KEY];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function isClientHistoryEntry(state: unknown = window.history.state): boolean {
  return Boolean(
    state &&
    typeof state === "object" &&
    (state as Record<string, unknown>)[SHELL_CLIENT_ENTRY_STATE_KEY] === true,
  );
}

export function replaceClientScrollTop(scrollTop: number): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(historyStateWithScrollTop(window.history.state, scrollTop), "");
}

export function subscribeBeforeClientUrlCommit(listener: () => void): () => void {
  beforeClientUrlCommitListeners.add(listener);
  return () => beforeClientUrlCommitListeners.delete(listener);
}

export function commitClientUrl(
  href: string,
  mode: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;
  for (const listener of beforeClientUrlCommitListeners) listener();
  if (mode === "replace") {
    window.history.replaceState(window.history.state, "", href);
  } else {
    window.history.pushState({
      ...historyStateWithScrollTop(window.history.state, 0),
      [SHELL_CLIENT_ENTRY_STATE_KEY]: true,
    }, "", href);
  }
}
