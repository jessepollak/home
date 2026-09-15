// Route contract.
// POST /api/client-performance → 204

export const HOME_STARTUP_VERSION = 1 as const;
// Closed low-cardinality page labels: the root landing plus the canonical L1
// shell routes. Dynamic L2 paths normalize to their L1 label before sending.
export const HOME_STARTUP_ROUTES = [
  "/",
  "/home",
  "/balances",
  "/activity",
  "/save",
  "/borrow",
  "/invest",
] as const;
export const HOME_STARTUP_OUTCOMES = [
  "ready",
  "signed-out",
  "unavailable",
  "timeout",
] as const;
export const HOME_STARTUP_CACHE_STATES = ["restored", "cold", "unknown"] as const;
export const HOME_AUTH_HINTS = ["none", "cdp", "base"] as const;
export const HOME_AUTH_OUTCOMES = ["signed-out", "verified", "unavailable", "timeout"] as const;

export type HomeStartupRoute = (typeof HOME_STARTUP_ROUTES)[number];
export type HomeStartupOutcome = (typeof HOME_STARTUP_OUTCOMES)[number];
export type HomeStartupCacheState = (typeof HOME_STARTUP_CACHE_STATES)[number];
export type HomeAuthHint = (typeof HOME_AUTH_HINTS)[number];
export type HomeAuthOutcome = (typeof HOME_AUTH_OUTCOMES)[number];

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
  sessionSettledMs: number;
  totalMs: number;
};

export type ClientPerformanceReport = HomeStartupReport | HomeAuthRestoreReport;

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
  "sessionSettledMs",
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
  if (record.kind === "home-auth-phase") return parseHomeAuthRestoreReport(record);
  return null;
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
    !isAllowed(record.outcome, HOME_AUTH_OUTCOMES)
  ) return null;

  const sessionSettledMs = normalizeDuration(record.sessionSettledMs, 50, 30_000);
  const totalMs = normalizeDuration(record.totalMs, 50, 30_000);
  if (sessionSettledMs === null || totalMs === null) return null;

  const optionalDurations: Partial<Pick<
    HomeAuthRestoreReport,
    "sdkActivateMs" | "cdpInitializedMs" | "nativeSettledMs"
  >> = {};
  for (const key of ["sdkActivateMs", "cdpInitializedMs", "nativeSettledMs"] as const) {
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
    sessionSettledMs,
    totalMs,
  };
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

/**
 * Normalizes an arbitrary pathname to its low-cardinality startup route label:
 * the L1 page for every canonical and L2 path, `null` for anything else.
 */
export function normalizeHomeStartupRoute(pathname: string): HomeStartupRoute | null {
  if (pathname === "/") return "/";
  const first = pathname.split("/").filter((segment) => segment.length > 0)[0];
  return HOME_STARTUP_ROUTES.find((route) => route !== "/" && route === `/${first}`) ?? null;
}
