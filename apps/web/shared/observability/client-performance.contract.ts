
export const HOME_STARTUP_VERSION = 1 as const;
export const HOME_STARTUP_ROUTES = [
  "/",
  "/home",
  "/card",
  "/balances",
  "/activity",
  "/cash",
  "/borrow",
  "/investments",
  "/invest",
] as const;
export const HOME_INTERACTION_ROUTES = [
  "/home", "/card", "/balances", "/activity", "/cash", "/borrow", "/investments", "/invest",
] as const;
export const HOME_PANEL_CACHE_STATES = ["retained", "first-visit"] as const;
export const HOME_DEVICE_CLASSES = [
  "mobile-low", "mobile-high", "mobile-unknown", "desktop-low", "desktop-high", "desktop-unknown",
] as const;
export const HOME_ENGINES = ["chromium", "webkit", "gecko", "other"] as const;
export const CLIENT_PERFORMANCE_KINDS = [
  "home-startup", "home-auth-phase", "home-navigation", "home-scroll",
] as const;
export const HOME_NAVIGATION_TRIGGERS = ["in-app", "history"] as const;
export const HOME_STARTUP_OUTCOMES = [
  "ready",
  "signed-out",
  "unavailable",
  "timeout",
] as const;
export const HOME_STARTUP_CACHE_STATES = ["restored", "cold", "unknown"] as const;
export const HOME_AUTH_HINTS = ["none", "cdp", "base"] as const;
export const HOME_AUTH_OUTCOMES = ["signed-out", "verified", "unavailable", "timeout"] as const;
export const HOME_AUTH_RESTORE_STAGES = ["token", "validation"] as const;
export const HOME_AUTH_SIGNOUT_OUTCOMES = ["success", "error", "timeout"] as const;

export type HomeStartupRoute = (typeof HOME_STARTUP_ROUTES)[number];
export type HomeInteractionRoute = (typeof HOME_INTERACTION_ROUTES)[number];
export type HomePanelCacheState = (typeof HOME_PANEL_CACHE_STATES)[number];
export type HomeDeviceClass = (typeof HOME_DEVICE_CLASSES)[number];
export type HomeEngine = (typeof HOME_ENGINES)[number];
export type ClientPerformanceKind = (typeof CLIENT_PERFORMANCE_KINDS)[number];
export type HomeNavigationTrigger = (typeof HOME_NAVIGATION_TRIGGERS)[number];
export type HomeStartupOutcome = (typeof HOME_STARTUP_OUTCOMES)[number];
export type HomeStartupCacheState = (typeof HOME_STARTUP_CACHE_STATES)[number];
export type HomeAuthHint = (typeof HOME_AUTH_HINTS)[number];
export type HomeAuthOutcome = (typeof HOME_AUTH_OUTCOMES)[number];
export type HomeAuthRestoreStage = "token" | "validation";
export type HomeAuthSignOutOutcome = (typeof HOME_AUTH_SIGNOUT_OUTCOMES)[number];

export function clientPerformanceBucket(kind: ClientPerformanceKind): "interaction" | "reporting" {
  return kind === "home-navigation" || kind === "home-scroll" ? "interaction" : "reporting";
}

export type HomeStartupReport = {
  version: typeof HOME_STARTUP_VERSION;
  kind: "home-startup";
  route: HomeStartupRoute;
  outcome: HomeStartupOutcome;
  cache: HomeStartupCacheState;
  shellMs: number;
  sessionMs?: number;
  balancesMs?: number;
  interactiveMs?: number;
  totalMs: number;
};

export type HomeAuthRestoreReport = {
  version: typeof HOME_STARTUP_VERSION;
  kind: "home-auth-phase";
  route: HomeStartupRoute;
  flow: "restore";
  hint: HomeAuthHint;
  outcome: HomeAuthOutcome;
  sdkActivateMs?: number;
  cdpInitializedMs?: number;
  nativeSettledMs?: number;
  tokenMs?: number;
  validationMs?: number;
  stalledStage?: HomeAuthRestoreStage;
  sessionSettledMs: number;
  totalMs: number;
};

export type HomeAuthSignOutReport = {
  version: typeof HOME_STARTUP_VERSION;
  kind: "home-auth-phase";
  route: HomeStartupRoute;
  flow: "signout";
  outcome: HomeAuthSignOutOutcome;
  visibleNavigationMs?: number;
  nativeLogoutAttempted: boolean;
  nativeLogoutMs?: number;
  walletDisconnectAttempted: boolean;
  walletDisconnectMs?: number;
  cdpSignOutAttempted: boolean;
  cdpSignOutMs?: number;
  totalMs: number;
};

export type HomeNavigationReport = {
  version: 1;
  kind: "home-navigation";
  route: HomeInteractionRoute;
  from: HomeInteractionRoute;
  trigger: HomeNavigationTrigger;
  cache: HomePanelCacheState;
  device: HomeDeviceClass;
  engine?: HomeEngine;
  durationMs: number;
  dispatchDelayMs?: number;
  inputToPaintMs?: number;
  cachePersistMs?: number;
  contentState?: "loading" | "ready" | "unavailable";
};

export type HomeScrollReport = {
  version: 1;
  kind: "home-scroll";
  route: HomeInteractionRoute;
  cache: HomePanelCacheState;
  device: HomeDeviceClass;
  engine?: HomeEngine;
  durationMs: number;
  frameCount: number;
  slowFrameCount: number;
  maxFrameMs: number;
  longFrameCount?: number;
  longFrameMs?: number;
};

export type ClientPerformanceReport = HomeStartupReport | HomeAuthRestoreReport | HomeAuthSignOutReport |
  HomeNavigationReport | HomeScrollReport;

const navigationRequiredKeys = new Set([
  "version", "kind", "route", "from", "trigger", "cache", "device", "durationMs",
]);
const navigationAllowedKeys = new Set([...navigationRequiredKeys, "engine", "dispatchDelayMs", "inputToPaintMs", "cachePersistMs", "contentState"]);
const scrollRequiredKeys = new Set([
  "version", "kind", "route", "cache", "device", "durationMs", "frameCount", "slowFrameCount", "maxFrameMs",
]);
const scrollAllowedKeys = new Set([...scrollRequiredKeys, "engine", "longFrameCount", "longFrameMs"]);

const startupAllowedKeys = new Set([
  "version",
  "kind",
  "route",
  "outcome",
  "cache",
  "shellMs",
  "sessionMs",
  "balancesMs",
  "interactiveMs",
  "totalMs",
]);
const startupRequiredKeys = new Set([
  "version",
  "kind",
  "route",
  "outcome",
  "cache",
  "shellMs",
  "totalMs",
]);
const authAllowedKeys = new Set([
  "version",
  "kind",
  "route",
  "flow",
  "hint",
  "outcome",
  "sdkActivateMs",
  "cdpInitializedMs",
  "nativeSettledMs",
  "tokenMs",
  "validationMs",
  "stalledStage",
  "sessionSettledMs",
  "totalMs",
]);
const authSignOutAllowedKeys = new Set([
  "version",
  "kind",
  "route",
  "flow",
  "outcome",
  "visibleNavigationMs",
  "nativeLogoutAttempted",
  "nativeLogoutMs",
  "walletDisconnectAttempted",
  "walletDisconnectMs",
  "cdpSignOutAttempted",
  "cdpSignOutMs",
  "totalMs",
]);
const authSignOutRequiredKeys = new Set([
  "version",
  "kind",
  "route",
  "flow",
  "outcome",
  "nativeLogoutAttempted",
  "walletDisconnectAttempted",
  "cdpSignOutAttempted",
  "totalMs",
]);
const authRequiredKeys = new Set([
  "version",
  "kind",
  "route",
  "flow",
  "hint",
  "outcome",
  "sessionSettledMs",
  "totalMs",
]);

export function parseClientPerformanceReport(value: unknown): ClientPerformanceReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "home-startup") return parseHomeStartupReport(record);
  if (record.kind === "home-navigation") return parseHomeNavigationReport(record);
  if (record.kind === "home-scroll") return parseHomeScrollReport(record);
  if (record.kind === "home-auth-phase") {
    return record.flow === "signout"
      ? parseHomeAuthSignOutReport(record)
      : parseHomeAuthRestoreReport(record);
  }
  return null;
}

function hasInteractionDimensions(record: Record<string, unknown>): record is Record<string, unknown> & {
  route: HomeInteractionRoute; cache: HomePanelCacheState; device: HomeDeviceClass;
} {
  return record.version === HOME_STARTUP_VERSION &&
    isAllowed(record.route, HOME_INTERACTION_ROUTES) &&
    isAllowed(record.cache, HOME_PANEL_CACHE_STATES) &&
    isAllowed(record.device, HOME_DEVICE_CLASSES);
}

function parseHomeNavigationReport(record: Record<string, unknown>): HomeNavigationReport | null {
  if (!hasExactShape(record, navigationAllowedKeys, navigationRequiredKeys) ||
    !hasInteractionDimensions(record) || !isAllowed(record.from, HOME_INTERACTION_ROUTES) ||
    record.from === record.route || !isAllowed(record.trigger, HOME_NAVIGATION_TRIGGERS) ||
    !hasValidEngine(record)) return null;
  const durationMs = normalizeDuration(record.durationMs, 10, 10_000);
  if (durationMs === null) return null;
  const timings: Partial<Pick<HomeNavigationReport, "dispatchDelayMs" | "inputToPaintMs" | "cachePersistMs">> = {};
  for (const key of ["dispatchDelayMs", "inputToPaintMs", "cachePersistMs"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const value = normalizeDuration(record[key], 10, 30_000);
    if (value === null) return null;
    timings[key] = value;
  }
  if ((timings.dispatchDelayMs === undefined) !== (timings.inputToPaintMs === undefined) ||
    (timings.dispatchDelayMs !== undefined && timings.inputToPaintMs !== undefined && (record.trigger !== "in-app" ||
      timings.dispatchDelayMs > timings.inputToPaintMs || timings.inputToPaintMs < durationMs))) return null;
  if (Object.hasOwn(record, "contentState") && record.contentState !== "loading" &&
    record.contentState !== "ready" && record.contentState !== "unavailable") return null;
  return { version: 1, kind: "home-navigation", route: record.route, from: record.from,
    trigger: record.trigger, cache: record.cache, device: record.device,
    ...timings,
    ...(record.contentState === "loading" || record.contentState === "ready" || record.contentState === "unavailable"
      ? { contentState: record.contentState } : {}),
    ...(Object.hasOwn(record, "engine") ? { engine: record.engine as HomeEngine } : {}), durationMs };
}

function parseHomeScrollReport(record: Record<string, unknown>): HomeScrollReport | null {
  const hasLongCount = Object.hasOwn(record, "longFrameCount");
  const hasLongMs = Object.hasOwn(record, "longFrameMs");
  if (!hasExactShape(record, scrollAllowedKeys, scrollRequiredKeys) ||
    !hasInteractionDimensions(record) || !hasValidEngine(record) || hasLongCount !== hasLongMs) return null;
  const durationMs = normalizeDuration(record.durationMs, 50, 30_000);
  const frameCount = normalizeDuration(record.frameCount, 1, 10_000);
  const slowFrameCount = normalizeDuration(record.slowFrameCount, 1, 10_000);
  const maxFrameMs = normalizeDuration(record.maxFrameMs, 10, 5_000);
  const longFrameCount = hasLongCount ? normalizeDuration(record.longFrameCount, 1, 1_000) : 0;
  const longFrameMs = hasLongMs ? normalizeDuration(record.longFrameMs, 10, 30_000) : 0;
  if (durationMs === null || frameCount === null || slowFrameCount === null || maxFrameMs === null ||
    longFrameCount === null || longFrameMs === null) return null;
  return { version: 1, kind: "home-scroll", route: record.route, cache: record.cache, device: record.device,
    ...(Object.hasOwn(record, "engine") ? { engine: record.engine as HomeEngine } : {}),
    durationMs, frameCount, slowFrameCount: Math.min(slowFrameCount, frameCount), maxFrameMs,
    ...(hasLongCount ? { longFrameCount, longFrameMs } : {}) };
}

function parseHomeStartupReport(record: Record<string, unknown>): HomeStartupReport | null {
  if (
    !hasExactShape(record, startupAllowedKeys, startupRequiredKeys) ||
    record.version !== HOME_STARTUP_VERSION ||
    !isAllowed(record.route, HOME_STARTUP_ROUTES) ||
    !isAllowed(record.outcome, HOME_STARTUP_OUTCOMES) ||
    !isAllowed(record.cache, HOME_STARTUP_CACHE_STATES)
  ) return null;

  const shellMs = normalizeDuration(record.shellMs, 1, 60_000);
  const totalMs = normalizeDuration(record.totalMs, 1, 60_000);
  if (shellMs === null || totalMs === null) return null;

  const optionalDurations: Partial<Pick<
    HomeStartupReport,
    "sessionMs" | "balancesMs" | "interactiveMs"
  >> = {};
  for (const key of ["sessionMs", "balancesMs", "interactiveMs"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const normalized = normalizeDuration(record[key], 1, 60_000);
    if (normalized === null) return null;
    optionalDurations[key] = normalized;
  }

  return {
    version: HOME_STARTUP_VERSION,
    kind: "home-startup",
    route: record.route,
    outcome: record.outcome,
    cache: record.cache,
    shellMs,
    ...optionalDurations,
    totalMs,
  };
}

function parseHomeAuthRestoreReport(record: Record<string, unknown>): HomeAuthRestoreReport | null {
  if (
    !hasExactShape(record, authAllowedKeys, authRequiredKeys) ||
    record.version !== HOME_STARTUP_VERSION ||
    record.flow !== "restore" ||
    !isAllowed(record.route, HOME_STARTUP_ROUTES) ||
    !isAllowed(record.hint, HOME_AUTH_HINTS) ||
    !isAllowed(record.outcome, HOME_AUTH_OUTCOMES) ||
    (Object.hasOwn(record, "stalledStage") && !isAllowed(record.stalledStage, HOME_AUTH_RESTORE_STAGES))
  ) return null;

  const sessionSettledMs = normalizeDuration(record.sessionSettledMs, 50, 30_000);
  const totalMs = normalizeDuration(record.totalMs, 50, 30_000);
  if (sessionSettledMs === null || totalMs === null) return null;

  const optionalDurations: Partial<Pick<
    HomeAuthRestoreReport,
    "sdkActivateMs" | "cdpInitializedMs" | "nativeSettledMs" | "tokenMs" | "validationMs"
  >> = {};
  for (const key of ["sdkActivateMs", "cdpInitializedMs", "nativeSettledMs", "tokenMs", "validationMs"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const normalized = normalizeDuration(record[key], 50, 30_000);
    if (normalized === null) return null;
    optionalDurations[key] = normalized;
  }

  return {
    version: HOME_STARTUP_VERSION,
    kind: "home-auth-phase",
    route: record.route,
    flow: "restore",
    hint: record.hint,
    outcome: record.outcome,
    ...optionalDurations,
    ...(Object.hasOwn(record, "stalledStage") ? { stalledStage: record.stalledStage as HomeAuthRestoreStage } : {}),
    sessionSettledMs,
    totalMs,
  };
}

function parseHomeAuthSignOutReport(record: Record<string, unknown>): HomeAuthSignOutReport | null {
  if (
    !hasExactShape(record, authSignOutAllowedKeys, authSignOutRequiredKeys) ||
    record.version !== HOME_STARTUP_VERSION ||
    record.flow !== "signout" ||
    !isAllowed(record.route, HOME_STARTUP_ROUTES) ||
    !isAllowed(record.outcome, HOME_AUTH_SIGNOUT_OUTCOMES) ||
    typeof record.nativeLogoutAttempted !== "boolean" ||
    typeof record.walletDisconnectAttempted !== "boolean" ||
    typeof record.cdpSignOutAttempted !== "boolean"
  ) return null;
  const totalMs = normalizeDuration(record.totalMs, 50, 30_000);
  if (totalMs === null) return null;
  const durations: Partial<Pick<HomeAuthSignOutReport,
    "visibleNavigationMs" | "nativeLogoutMs" | "walletDisconnectMs" | "cdpSignOutMs"
  >> = {};
  for (const key of ["visibleNavigationMs", "nativeLogoutMs", "walletDisconnectMs", "cdpSignOutMs"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const normalized = normalizeDuration(record[key], 50, 30_000);
    if (normalized === null) return null;
    durations[key] = normalized;
  }
  return {
    version: HOME_STARTUP_VERSION,
    kind: "home-auth-phase",
    route: record.route,
    flow: "signout",
    outcome: record.outcome,
    ...durations,
    nativeLogoutAttempted: record.nativeLogoutAttempted,
    walletDisconnectAttempted: record.walletDisconnectAttempted,
    cdpSignOutAttempted: record.cdpSignOutAttempted,
    totalMs,
  };
}

function hasValidEngine(record: Record<string, unknown>): boolean {
  return !Object.hasOwn(record, "engine") || isAllowed(record.engine, HOME_ENGINES);
}

function hasExactShape(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(record);
  return !keys.some((key) => !allowedKeys.has(key)) &&
    ![...requiredKeys].some((key) => !Object.hasOwn(record, key));
}

function normalizeDuration(value: unknown, increment: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value / increment) * increment;
  return Math.min(maximum, Math.max(0, rounded));
}

function isAllowed<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

export function normalizeHomeStartupRoute(pathname: string): HomeStartupRoute | null {
  if (pathname === "/") return "/";
  const first = pathname.split("/").filter((segment) => segment.length > 0)[0];
  return HOME_STARTUP_ROUTES.find((route) => route !== "/" && route === `/${first}`) ?? null;
}
