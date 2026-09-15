import "server-only";

import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";
import type {
  HomeAuthRestoreReport,
  HomeAuthSignOutReport,
  HomeStartupReport,
} from "@/shared/observability/client-performance.contract";

export const OBSERVABILITY_SCHEMA = "home.observability.v2" as const;

export const ACTIVITY_READ_OUTCOMES = [
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
] as const;
export const ACTIVITY_READ_REASONS = [
  "none",
  "authorization",
  "request",
  "primary-source",
] as const;
export const ACTIVITY_READ_SOURCES = ["none", "cdp-sql"] as const;
export type ActivityReadOutcome = (typeof ACTIVITY_READ_OUTCOMES)[number];
export type ActivityReadReason = (typeof ACTIVITY_READ_REASONS)[number];
export type ActivityReadSource = (typeof ACTIVITY_READ_SOURCES)[number];

export type PortfolioBalanceSourceReason =
  | "not-configured"
  | "unauthorized"
  | "rate-limited"
  | "timed-out"
  | "upstream-error"
  | "invalid-response"
  | "partial"
  | "read-failed";

export const BALANCES_READ_OUTCOMES = [
  "served-row",
  "registry-only",
  "full",
  "revalidating",
  "background-full",
  "background-resume",
  "background-error",
  "stale-fallback",
  "error",
] as const;
export type BalancesReadOutcome = (typeof BALANCES_READ_OUTCOMES)[number];
export type BalancesReadDurations = {
  "store-read": number;
  enumerate: number;
  "registry-read": number;
  resolve: number;
  price: number;
  "valuation-store": number;
  codex: number;
  coinbase: number;
  "store-write": number;
  total: number;
};

export const SERVER_EVENT_KINDS = [
  "action-prepare",
  "action-confirm",
  "action-handle",
  "action-reconcile",
  "borrow-overview",
  "funding-order",
  "funding-webhook",
  "balances-webhook",
  "balances-webhook-subscription",
  "balances-store",
  "balances-signal",
  "balances-valuation",
] as const;
export const SERVER_EVENT_OUTCOMES = [
  "failed",
  "ok",
  "conflict",
  "rejected",
  "invalid",
  "unmatched",
  "unavailable",
  "accepted",
  "ignored",
] as const;
export const FUNDING_ORDER_CODES = [
  "ORDER_UNAVAILABLE",
  "FUNDING_SANDBOX_MIGRATION_REQUIRED",
  "OFFRAMP_DISCOVERY_CONFIGURATION",
  "OFFRAMP_DISCOVERY_PROVIDER",
  "QUOTE_ECHO_MISMATCH",
  "ORDER_ECHO_MISMATCH",
  "ORDER_AMBIGUOUS",
  "STATUS_ECHO_MISMATCH",
  "PROVIDER_HTTP_4XX",
  "PROVIDER_HTTP_5XX",
  "PROVIDER_TRANSPORT",
] as const;
export type ServerEventKind = (typeof SERVER_EVENT_KINDS)[number];
export type ServerEventOutcome = (typeof SERVER_EVENT_OUTCOMES)[number];

export type ObservabilityEvent =
  | HomeStartupReport
  | HomeAuthRestoreReport
  | HomeAuthSignOutReport
  | {
      kind: "unhandled-server-error";
      route: string;
      method?: string;
      errorName?: string;
      routeType?: string;
    }
  | {
      kind: "client-error";
      route: string;
      errorName: string;
      summary: string;
    }
  | {
      kind: "portfolio-balance-source";
      route: "/api/balances";
      source: "cdp-token-balances" | "configured-base-rpc";
      stage: "inventory";
      outcome: "incomplete" | "unavailable";
      reason: PortfolioBalanceSourceReason;
      pageCount?: number;
      durationMs?: number;
    }
  | {
      kind: "balances-read";
      route: "/api/balances";
      outcome: BalancesReadOutcome;
      durationMs: BalancesReadDurations;
      coverage: {
        registry: "complete" | "partial" | "unknown";
        catalog: "complete" | "incomplete" | "unavailable" | "unknown";
      };
    }
  | {
      kind: "activity-read";
      route: string;
      outcome: ActivityReadOutcome;
      reason: ActivityReadReason;
      source: ActivityReadSource;
      durationMs: number;
      sourceDurationMs: number;
      sourceAttemptCount: number;
      pageCount: number;
      rowCount: number;
    }
  | {
      kind: ServerEventKind;
      route: string;
      code: string;
      outcome: ServerEventOutcome;
      provider?: string;
      ownerHash?: string;
      durationMs: number;
    };

type ObservabilityLogBase = {
  schema: typeof OBSERVABILITY_SCHEMA;
  route: string;
};

export type ObservabilityLogLine = ObservabilityLogBase &
  (
    | {
        level: "info" | "error";
        kind: "home-startup";
        code: "HOME_STARTUP";
        version: 1;
        outcome: HomeStartupReport["outcome"];
        cache: HomeStartupReport["cache"];
        shellMs: number;
        sessionMs?: number;
        balancesMs?: number;
        interactiveMs?: number;
        totalMs: number;
      }
    | {
        level: "info" | "error";
        kind: "home-auth-phase";
        code: "HOME_AUTH_PHASE";
        version: 1;
        flow: "restore";
        hint: HomeAuthRestoreReport["hint"];
        outcome: HomeAuthRestoreReport["outcome"];
        sdkActivateMs?: number;
        cdpInitializedMs?: number;
        nativeSettledMs?: number;
        sessionSettledMs: number;
        totalMs: number;
      }
    | {
        level: "info" | "error";
        kind: "home-auth-phase";
        code: "HOME_AUTH_PHASE";
        version: 1;
        flow: "signout";
        outcome: HomeAuthSignOutReport["outcome"];
        visibleNavigationMs?: number;
        nativeLogoutAttempted: boolean;
        nativeLogoutMs?: number;
        walletDisconnectAttempted: boolean;
        walletDisconnectMs?: number;
        cdpSignOutAttempted: boolean;
        cdpSignOutMs?: number;
        totalMs: number;
      }
    | {
        level: "error";
        kind: "unhandled-server-error";
        code: "UNHANDLED_SERVER_ERROR";
        errorName: string;
        method?: string;
        routeType?: string;
      }
    | {
        level: "error";
        kind: "client-error";
        code: "CLIENT_ERROR";
        errorName: string;
        summary: string;
      }
    | {
        level: "error";
        kind: "portfolio-balance-source";
        code: "PORTFOLIO_BALANCE_SOURCE";
        source: "cdp-token-balances" | "configured-base-rpc";
        stage: "inventory";
        outcome: "incomplete" | "unavailable";
        reason: PortfolioBalanceSourceReason;
        pageCount: number;
        durationMs: number;
      }
    | {
        level: "error" | "info";
        kind: "balances-read";
        code: "BALANCES_READ";
        outcome: BalancesReadOutcome;
        durationMs: BalancesReadDurations;
        coverage: {
          registry: "complete" | "partial" | "unknown";
          catalog: "complete" | "incomplete" | "unavailable" | "unknown";
        };
      }
    | {
        level: "error" | "info";
        kind: "activity-read";
        code: "ACTIVITY_READ";
        outcome: ActivityReadOutcome;
        reason: ActivityReadReason;
        source: ActivityReadSource;
        durationMs: number;
        sourceDurationMs: number;
        sourceAttemptCount: number;
        pageCount: number;
        rowCount: number;
      }
    | {
        level: "error" | "info";
        kind: ServerEventKind;
        code: string;
        outcome: ServerEventOutcome;
        provider?: string;
        ownerHash?: string;
        durationMs: number;
      }
  );

function sanitizeMethod(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const method = value.trim().toUpperCase();
  return /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)
    ? method
    : undefined;
}

export function normalizeObservabilityEvent(
  event: ObservabilityEvent,
): ObservabilityLogLine {
  const base = {
    schema: OBSERVABILITY_SCHEMA,
    route: sanitizeRoutePath(event.route),
  };

  if (event.kind === "home-startup") {
    return {
      schema: OBSERVABILITY_SCHEMA,
      route: event.route,
      level: event.outcome === "ready" || event.outcome === "signed-out" ? "info" : "error",
      kind: event.kind,
      code: "HOME_STARTUP",
      version: 1,
      outcome: event.outcome,
      cache: event.cache,
      shellMs: boundedInteger(event.shellMs, 60_000),
      ...(event.sessionMs === undefined
        ? {}
        : { sessionMs: boundedInteger(event.sessionMs, 60_000) }),
      ...(event.balancesMs === undefined
        ? {}
        : { balancesMs: boundedInteger(event.balancesMs, 60_000) }),
      ...(event.interactiveMs === undefined
        ? {}
        : { interactiveMs: boundedInteger(event.interactiveMs, 60_000) }),
      totalMs: boundedInteger(event.totalMs, 60_000),
    };
  }

  if (event.kind === "home-auth-phase") {
    if (event.flow === "signout") {
      return {
        schema: OBSERVABILITY_SCHEMA,
        route: event.route,
        level: event.outcome === "success" ? "info" : "error",
        kind: event.kind,
        code: "HOME_AUTH_PHASE",
        version: 1,
        flow: "signout",
        outcome: event.outcome,
        ...(event.visibleNavigationMs === undefined ? {} : {
          visibleNavigationMs: boundedInteger(event.visibleNavigationMs, 30_000),
        }),
        nativeLogoutAttempted: event.nativeLogoutAttempted,
        ...(event.nativeLogoutMs === undefined ? {} : {
          nativeLogoutMs: boundedInteger(event.nativeLogoutMs, 30_000),
        }),
        walletDisconnectAttempted: event.walletDisconnectAttempted,
        ...(event.walletDisconnectMs === undefined ? {} : {
          walletDisconnectMs: boundedInteger(event.walletDisconnectMs, 30_000),
        }),
        cdpSignOutAttempted: event.cdpSignOutAttempted,
        ...(event.cdpSignOutMs === undefined ? {} : {
          cdpSignOutMs: boundedInteger(event.cdpSignOutMs, 30_000),
        }),
        totalMs: boundedInteger(event.totalMs, 30_000),
      };
    }
    return {
      schema: OBSERVABILITY_SCHEMA,
      route: event.route,
      level: event.outcome === "signed-out" || event.outcome === "verified" ? "info" : "error",
      kind: event.kind,
      code: "HOME_AUTH_PHASE",
      version: 1,
      flow: "restore",
      hint: event.hint,
      outcome: event.outcome,
      ...(event.sdkActivateMs === undefined
        ? {}
        : { sdkActivateMs: boundedInteger(event.sdkActivateMs, 30_000) }),
      ...(event.cdpInitializedMs === undefined
        ? {}
        : { cdpInitializedMs: boundedInteger(event.cdpInitializedMs, 30_000) }),
      ...(event.nativeSettledMs === undefined
        ? {}
        : { nativeSettledMs: boundedInteger(event.nativeSettledMs, 30_000) }),
      sessionSettledMs: boundedInteger(event.sessionSettledMs, 30_000),
      totalMs: boundedInteger(event.totalMs, 30_000),
    };
  }

  if (event.kind === "balances-read") {
    const outcome = allowedValue(event.outcome, BALANCES_READ_OUTCOMES, "error");
    return {
      ...base,
      level: outcome === "error" ? "error" : "info",
      kind: event.kind,
      code: "BALANCES_READ",
      outcome,
      durationMs: normalizeBalancesReadDurations(event.durationMs),
      coverage: {
        registry: allowedValue(
          event.coverage.registry,
          ["complete", "partial", "unknown"] as const,
          "unknown",
        ),
        catalog: allowedValue(
          event.coverage.catalog,
          ["complete", "incomplete", "unavailable", "unknown"] as const,
          "unknown",
        ),
      },
    };
  }

  if (event.kind === "activity-read") {
    const outcome = allowedValue(event.outcome, ACTIVITY_READ_OUTCOMES, "failed");
    return {
      ...base,
      level:
        outcome === "failed" || outcome === "cancelled" ? "error" : "info",
      kind: event.kind,
      code: "ACTIVITY_READ",
      outcome,
      reason: allowedValue(event.reason, ACTIVITY_READ_REASONS, "none"),
      source: allowedValue(event.source, ACTIVITY_READ_SOURCES, "none"),
      durationMs: boundedInteger(event.durationMs, 60_000),
      sourceDurationMs: boundedInteger(event.sourceDurationMs, 60_000),
      sourceAttemptCount: boundedInteger(event.sourceAttemptCount, 10),
      pageCount: boundedInteger(event.pageCount, 10),
      rowCount: boundedInteger(event.rowCount, 10_000),
    };
  }

  if (isServerEvent(event)) {
    const outcome = allowedValue(event.outcome, SERVER_EVENT_OUTCOMES, "failed");
    const code = event.kind === "funding-order"
      ? allowedValue(event.code, FUNDING_ORDER_CODES, "ORDER_UNAVAILABLE")
      : /^[A-Z][A-Z0-9_]{0,63}$/.test(event.code)
        ? event.code
        : "SERVER_EVENT";
    const provider = event.provider
      ? sanitizeIdentifier(event.provider, "unknown").slice(0, 64)
      : undefined;
    const ownerHash = event.ownerHash && /^[a-f0-9]{32}$/.test(event.ownerHash)
      ? event.ownerHash
      : undefined;
    return {
      ...base,
      level: outcome === "unmatched" || outcome === "ok" || outcome === "accepted" || outcome === "ignored" ||
        (event.kind === "action-reconcile" && outcome === "unavailable")
        ? "info"
        : "error",
      kind: event.kind,
      code,
      outcome,
      ...(provider ? { provider } : {}),
      ...(ownerHash ? { ownerHash } : {}),
      durationMs: boundedInteger(event.durationMs, 60_000),
    };
  }

  if (event.kind === "portfolio-balance-source") {
    return {
      ...base,
      level: "error",
      kind: event.kind,
      code: "PORTFOLIO_BALANCE_SOURCE",
      source: event.source,
      stage: event.stage,
      outcome: event.outcome,
      reason: event.reason,
      pageCount: boundedInteger(event.pageCount ?? 0, 32),
      durationMs: boundedInteger(event.durationMs ?? 0, 60_000),
    };
  }

  const errorName = sanitizeIdentifier(event.errorName ?? "Error", "Error");
  if (event.kind === "client-error") {
    return {
      ...base,
      level: "error",
      kind: event.kind,
      code: "CLIENT_ERROR",
      errorName,
      summary: scrubString(event.summary).trim().slice(0, 256) || "Client error",
    };
  }

  const method = sanitizeMethod(event.method);
  const routeType = event.routeType
    ? sanitizeIdentifier(event.routeType, "unknown").slice(0, 32)
    : undefined;

  return {
    ...base,
    level: "error",
    kind: event.kind,
    code: "UNHANDLED_SERVER_ERROR",
    errorName,
    ...(method ? { method } : {}),
    ...(routeType ? { routeType } : {}),
  };
}

function isServerEvent(
  event: ObservabilityEvent,
): event is Extract<ObservabilityEvent, { kind: ServerEventKind }> {
  return SERVER_EVENT_KINDS.includes(event.kind as ServerEventKind);
}

function normalizeBalancesReadDurations(
  durations: BalancesReadDurations,
): BalancesReadDurations {
  return {
    "store-read": boundedInteger(durations["store-read"], 60_000),
    enumerate: boundedInteger(durations.enumerate, 60_000),
    "registry-read": boundedInteger(durations["registry-read"], 60_000),
    resolve: boundedInteger(durations.resolve, 60_000),
    price: boundedInteger(durations.price, 60_000),
    "valuation-store": boundedInteger(durations["valuation-store"], 60_000),
    codex: boundedInteger(durations.codex, 60_000),
    coinbase: boundedInteger(durations.coinbase, 60_000),
    "store-write": boundedInteger(durations["store-write"], 60_000),
    total: boundedInteger(durations.total, 60_000),
  };
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function allowedValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}
