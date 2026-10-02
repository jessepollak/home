import * as z from "zod/mini";

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
  balanceCache?: HomeStartupCacheState;
  balanceFetchMs?: number;
  balanceResponseMs?: number;
  balanceParsedMs?: number;
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

function durationSchema(increment: number, maximum: number) {
  return z.pipe(
    z.number(),
    z.transform((value) => Math.min(maximum, Math.max(0, Math.round(value / increment) * increment))),
  );
}

const startupDurationSchema = durationSchema(1, 60_000);
const authDurationSchema = durationSchema(50, 30_000);
const navigationTimingSchema = durationSchema(10, 30_000);
const startupVersionSchema = z.literal(HOME_STARTUP_VERSION);
const startupRouteSchema = z.enum(HOME_STARTUP_ROUTES);
const interactionVersionSchema = z.literal(HOME_STARTUP_VERSION);
const interactionRouteSchema = z.enum(HOME_INTERACTION_ROUTES);
const interactionCacheSchema = z.enum(HOME_PANEL_CACHE_STATES);
const interactionDeviceSchema = z.enum(HOME_DEVICE_CLASSES);
const interactionEngineSchema = z.exactOptional(z.enum(HOME_ENGINES));

const homeStartupReportSchema = z.strictObject({
  version: startupVersionSchema,
  kind: z.literal("home-startup"),
  route: startupRouteSchema,
  outcome: z.enum(HOME_STARTUP_OUTCOMES),
  cache: z.enum(HOME_STARTUP_CACHE_STATES),
  shellMs: startupDurationSchema,
  sessionMs: z.exactOptional(startupDurationSchema),
  balancesMs: z.exactOptional(startupDurationSchema),
  interactiveMs: z.exactOptional(startupDurationSchema),
  balanceFetchMs: z.exactOptional(startupDurationSchema),
  balanceResponseMs: z.exactOptional(startupDurationSchema),
  balanceParsedMs: z.exactOptional(startupDurationSchema),
  balanceCache: z.exactOptional(z.enum(HOME_STARTUP_CACHE_STATES)),
  totalMs: startupDurationSchema,
});

const homeAuthRestoreReportSchema = z.strictObject({
  version: startupVersionSchema,
  kind: z.literal("home-auth-phase"),
  route: startupRouteSchema,
  flow: z.literal("restore"),
  hint: z.enum(HOME_AUTH_HINTS),
  outcome: z.enum(HOME_AUTH_OUTCOMES),
  sdkActivateMs: z.exactOptional(authDurationSchema),
  cdpInitializedMs: z.exactOptional(authDurationSchema),
  nativeSettledMs: z.exactOptional(authDurationSchema),
  tokenMs: z.exactOptional(authDurationSchema),
  validationMs: z.exactOptional(authDurationSchema),
  stalledStage: z.exactOptional(z.enum(HOME_AUTH_RESTORE_STAGES)),
  sessionSettledMs: authDurationSchema,
  totalMs: authDurationSchema,
});

const homeAuthSignOutReportSchema = z.strictObject({
  version: startupVersionSchema,
  kind: z.literal("home-auth-phase"),
  route: startupRouteSchema,
  flow: z.literal("signout"),
  outcome: z.enum(HOME_AUTH_SIGNOUT_OUTCOMES),
  visibleNavigationMs: z.exactOptional(authDurationSchema),
  nativeLogoutMs: z.exactOptional(authDurationSchema),
  walletDisconnectMs: z.exactOptional(authDurationSchema),
  cdpSignOutMs: z.exactOptional(authDurationSchema),
  nativeLogoutAttempted: z.boolean(),
  walletDisconnectAttempted: z.boolean(),
  cdpSignOutAttempted: z.boolean(),
  totalMs: authDurationSchema,
});

const homeNavigationReportSchema = z.strictObject({
  version: interactionVersionSchema,
  kind: z.literal("home-navigation"),
  route: interactionRouteSchema,
  from: z.enum(HOME_INTERACTION_ROUTES),
  trigger: z.enum(HOME_NAVIGATION_TRIGGERS),
  cache: interactionCacheSchema,
  device: interactionDeviceSchema,
  dispatchDelayMs: z.exactOptional(navigationTimingSchema),
  inputToPaintMs: z.exactOptional(navigationTimingSchema),
  cachePersistMs: z.exactOptional(navigationTimingSchema),
  contentState: z.exactOptional(z.enum(["loading", "ready", "unavailable"])),
  engine: interactionEngineSchema,
  durationMs: durationSchema(10, 10_000),
}).check(
  z.refine((report) => report.from !== report.route),
  z.refine((report) => (report.dispatchDelayMs === undefined) === (report.inputToPaintMs === undefined)),
  z.refine((report) => report.dispatchDelayMs === undefined || report.inputToPaintMs === undefined ||
    (report.trigger === "in-app" && report.dispatchDelayMs <= report.inputToPaintMs &&
      report.inputToPaintMs >= report.durationMs)),
);

const homeScrollReportSchema = z.strictObject({
  version: interactionVersionSchema,
  kind: z.literal("home-scroll"),
  route: interactionRouteSchema,
  cache: interactionCacheSchema,
  device: interactionDeviceSchema,
  engine: interactionEngineSchema,
  durationMs: durationSchema(50, 30_000),
  frameCount: durationSchema(1, 10_000),
  slowFrameCount: durationSchema(1, 10_000),
  maxFrameMs: durationSchema(10, 5_000),
  longFrameCount: z.exactOptional(durationSchema(1, 1_000)),
  longFrameMs: z.exactOptional(navigationTimingSchema),
}).check(
  z.refine((report) => (report.longFrameCount === undefined) === (report.longFrameMs === undefined)),
  z.overwrite((report) => ({ ...report, slowFrameCount: Math.min(report.slowFrameCount, report.frameCount) })),
);

export function parseClientPerformanceReport(value: unknown): ClientPerformanceReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const schema = record.kind === "home-startup" ? homeStartupReportSchema :
    record.kind === "home-navigation" ? homeNavigationReportSchema :
    record.kind === "home-scroll" ? homeScrollReportSchema :
    record.kind === "home-auth-phase" ? (record.flow === "signout" ? homeAuthSignOutReportSchema : homeAuthRestoreReportSchema) : null;
  if (!schema) return null;
  const keys = new Set([...Object.keys(record), ...Object.keys(schema.shape).filter((key) => Object.hasOwn(record, key))]);
  const ownRecord = Object.fromEntries([...keys].map((key) => [key, record[key]]));
  if (schema === homeStartupReportSchema && !Object.hasOwn(record, "balanceCache") &&
    homeStartupReportSchema.shape.balanceCache.safeParse(record.balanceCache).success) {
    ownRecord.balanceCache = record.balanceCache;
  }
  if (schema === homeNavigationReportSchema && !Object.hasOwn(record, "contentState") &&
    homeNavigationReportSchema.shape.contentState.safeParse(record.contentState).success) {
    ownRecord.contentState = record.contentState;
  }
  const result = schema.safeParse(ownRecord);
  return result.success ? result.data : null;
}

export function normalizeHomeStartupRoute(pathname: string): HomeStartupRoute | null {
  if (pathname === "/") return "/";
  const first = pathname.split("/").filter((segment) => segment.length > 0)[0];
  return HOME_STARTUP_ROUTES.find((route) => route !== "/" && route === `/${first}`) ?? null;
}
