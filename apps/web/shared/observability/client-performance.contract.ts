// Route contract.
// POST /api/client-performance → 204

export const HOME_STARTUP_VERSION = 1 as const;
export const HOME_STARTUP_ROUTES = ["/", "/dashboard"] as const;
export const HOME_STARTUP_OUTCOMES = [
  "ready",
  "signed-out",
  "unavailable",
  "timeout",
] as const;
export const HOME_STARTUP_CACHE_STATES = ["restored", "cold", "unknown"] as const;

export type HomeStartupRoute = (typeof HOME_STARTUP_ROUTES)[number];
export type HomeStartupOutcome = (typeof HOME_STARTUP_OUTCOMES)[number];
export type HomeStartupCacheState = (typeof HOME_STARTUP_CACHE_STATES)[number];

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

const allowedKeys = new Set([
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
const requiredKeys = new Set([
  "version",
  "kind",
  "route",
  "outcome",
  "cache",
  "shellMs",
  "totalMs",
]);

export function parseClientPerformanceReport(value: unknown): HomeStartupReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowedKeys.has(key)) ||
    [...requiredKeys].some((key) => !Object.hasOwn(record, key)) ||
    record.version !== HOME_STARTUP_VERSION ||
    record.kind !== "home-startup" ||
    !isAllowed(record.route, HOME_STARTUP_ROUTES) ||
    !isAllowed(record.outcome, HOME_STARTUP_OUTCOMES) ||
    !isAllowed(record.cache, HOME_STARTUP_CACHE_STATES)
  ) {
    return null;
  }

  const shellMs = normalizeDuration(record.shellMs);
  const totalMs = normalizeDuration(record.totalMs);
  if (shellMs === null || totalMs === null) return null;

  const optionalDurations: Partial<Pick<
    HomeStartupReport,
    "sessionMs" | "balancesMs" | "interactiveMs"
  >> = {};
  for (const key of ["sessionMs", "balancesMs", "interactiveMs"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const normalized = normalizeDuration(record[key]);
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

function normalizeDuration(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(60_000, Math.max(0, Math.round(value)));
}

function isAllowed<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}
