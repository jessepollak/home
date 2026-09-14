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
