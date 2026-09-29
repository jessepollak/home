import "server-only";

import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";
import { HOME_AUTH_RESTORE_STAGES, HOME_ENGINES } from "@/shared/observability/client-performance.contract";
import type {
  HomeAuthRestoreReport,
  HomeAuthSignOutReport,
  HomeStartupReport,
  HomeNavigationReport,
  HomeScrollReport,
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
export const ACTIVITY_READ_SOURCES = [
  "none",
  "cdp-sql",
  "cdp-address-history",
] as const;
export type ActivityReadOutcome = (typeof ACTIVITY_READ_OUTCOMES)[number];
export type ActivityReadReason = (typeof ACTIVITY_READ_REASONS)[number];
export type ActivityReadSource = (typeof ACTIVITY_READ_SOURCES)[number];
export type ActivityReadValuation = {
  priced: number;
  unknownToken: number;
  noRecentClose: number;
  quoteUnavailable: number;
  fxUnavailable: number;
};

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
export type BalancesReadIncomplete = {
  registry: number;
  catalog: number;
  borrow: number;
  balanceUnavailable: number;
  valueUnavailable: number;
  priceUnavailable: number;
  priceStale: number;
  fxUnavailable: number;
  belowMarketGate: number;
  noQuoteCurrency: number;
};
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
  "action-read",
  "action-confirm",
  "action-handle",
  "action-decline",
  "action-outcome",
  "action-reconcile",
  "borrow-overview",
  "funding-order",
  "funding-webhook",
  "cards-webhook",
  "balances-webhook",
  "balances-webhook-subscription",
  "balances-store",
  "balances-signal",
  "balances-valuation",
  "operator-registry",
  "upstream-call",
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
  "skipped",
] as const;
export const FUNDING_ORDER_LIFECYCLE_CODES = [
  "ORDER_CREATED",
  "ORDER_REJECTED",
  "ORDER_AMBIGUOUS",
  "ORDER_AMBIGUOUS_RESOLVED",
  "ORDER_SENT_UNVERIFIED",
  "ORDER_RECEIVED",
  "ORDER_EXPIRED",
  "ORDER_CANCELLED",
  "ORDER_FAILED",
  "ORDER_REFUNDED",
] as const;
export const FUNDING_ORDER_CODES = [
  "ORDER_UNAVAILABLE",
  "USER_TOKEN_KEY_UNAVAILABLE",
  "USER_TOKEN_EXPIRED",
  "USER_TOKEN_UNREADABLE",
  "USER_TOKEN_PRESERVED_UNREADABLE",
  "USER_TOKEN_CAPTURE_CONFLICT",
  "USER_TOKEN_STORE_FAILURE",
  "USER_TOKEN_CLEARED_AFTER_REJECTION",
  "USER_TOKEN_REJECTION_CLEAR_CONFLICT",
  "USER_TOKEN_CAPTURED",
  ...FUNDING_ORDER_LIFECYCLE_CODES,
  "FUNDING_PROVIDER_CONFIGURATION",
  "FUNDING_SANDBOX_MIGRATION_REQUIRED",
  "FUNDING_BINDING_ENVIRONMENT_MISSING",
  "OFFRAMP_DISCOVERY_CONFIGURATION",
  "OFFRAMP_DISCOVERY_PROVIDER",
  "OFFRAMP_ORDER_MALFORMED_PAYEE_SKIPPED",
  "QUOTE_ECHO_MISMATCH",
  "ORDER_ECHO_MISMATCH",
  "STATUS_ECHO_MISMATCH",
  "PROVIDER_HTTP_4XX",
  "PROVIDER_HTTP_5XX",
  "PROVIDER_TRANSPORT",
  "PROVIDER_INVALID_RESPONSE",
  "UPSTREAM_ABORTED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_TRANSPORT",
  "UPSTREAM_HTTP_3XX",
  "UPSTREAM_HTTP_4XX",
  "UPSTREAM_HTTP_5XX",
  "UPSTREAM_OVERSIZED",
  "UPSTREAM_INVALID_RESPONSE",
] as const;
export type ServerEventKind = (typeof SERVER_EVENT_KINDS)[number];
export type ServerEventOutcome = (typeof SERVER_EVENT_OUTCOMES)[number];
export const UPSTREAM_CALL_CODES = [
  "UPSTREAM_OK",
  "UPSTREAM_ABORTED",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_TRANSPORT",
  "UPSTREAM_HTTP_3XX",
  "UPSTREAM_HTTP_4XX",
  "UPSTREAM_HTTP_5XX",
  "UPSTREAM_OVERSIZED",
  "UPSTREAM_INVALID_RESPONSE",
] as const;
export type UpstreamCallCode = (typeof UPSTREAM_CALL_CODES)[number];
export type UpstreamCallOutcome = "ok" | "skipped" | "unavailable" | "invalid";

export type ObservabilityEvent =
  | HomeStartupReport
  | ((HomeNavigationReport | HomeScrollReport) & { deployment: string })
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
      incomplete: BalancesReadIncomplete;
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
      valuation: ActivityReadValuation;
    }
  | {
      kind: "upstream-call";
      route: string;
      code: UpstreamCallCode;
      outcome: UpstreamCallOutcome;
      provider?: string;
      "http.request.method": string;
      "http.response.status_code"?: number;
      "error.type"?: string;
      durationMs: number;
    }
  | {
      kind: Exclude<ServerEventKind, "upstream-call">;
      route: string;
      code: string;
      outcome: ServerEventOutcome;
      provider?: string;
      region?: string;
      sandbox?: boolean;
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
        level: "info";
        kind: "home-navigation";
        code: "HOME_NAVIGATION";
        version: 1;
        from: HomeNavigationReport["from"];
        trigger: HomeNavigationReport["trigger"];
        cache: HomeNavigationReport["cache"];
        device: HomeNavigationReport["device"];
        engine?: HomeNavigationReport["engine"];
        deployment: string;
        durationMs: number;
        dispatchDelayMs?: number;
        inputToPaintMs?: number;
        cachePersistMs?: number;
        contentState?: HomeNavigationReport["contentState"];
      }
    | {
        level: "info";
        kind: "home-scroll";
        code: "HOME_SCROLL";
        version: 1;
        cache: HomeScrollReport["cache"];
        device: HomeScrollReport["device"];
        engine?: HomeScrollReport["engine"];
        deployment: string;
        durationMs: number;
        frameCount: number;
        slowFrameCount: number;
        maxFrameMs: number;
        longFrameCount?: number;
        longFrameMs?: number;
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
        tokenMs?: number;
        validationMs?: number;
        stalledStage?: HomeAuthRestoreReport["stalledStage"];
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
        incomplete: BalancesReadIncomplete;
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
        valuation: ActivityReadValuation;
      }
    | {
        level: "error" | "info";
        kind: "upstream-call";
        code: UpstreamCallCode;
        outcome: UpstreamCallOutcome;
        provider?: string;
        "http.request.method": string;
        "http.response.status_code"?: number;
        "error.type"?: string;
        durationMs: number;
      }
    | {
        level: "error" | "info";
        kind: Exclude<ServerEventKind, "upstream-call">;
        code: string;
        outcome: ServerEventOutcome;
        provider?: string;
        region?: string;
        sandbox?: boolean;
        ownerHash?: string;
        durationMs: number;
      }
  );

function sanitizeDeployment(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return /^dpl_[A-Za-z0-9]{1,60}$/.test(value) ? value : sanitizeIdentifier(value, "unknown");
}

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

  if (event.kind === "home-navigation") {
    return {
      schema: OBSERVABILITY_SCHEMA,
      route: event.route,
      level: "info",
      kind: event.kind,
      code: "HOME_NAVIGATION",
      version: 1,
      from: event.from,
      trigger: event.trigger,
      cache: event.cache,
      device: event.device,
      ...(HOME_ENGINES.some((engine) => engine === event.engine) ? { engine: event.engine } : {}),
      deployment: sanitizeDeployment(event.deployment),
      durationMs: boundedInteger(event.durationMs, 10_000),
      ...(event.dispatchDelayMs === undefined || event.inputToPaintMs === undefined ? {} : {
        dispatchDelayMs: boundedInteger(event.dispatchDelayMs, 30_000),
        inputToPaintMs: boundedInteger(event.inputToPaintMs, 30_000),
      }),
      ...(event.cachePersistMs === undefined ? {} : { cachePersistMs: boundedInteger(event.cachePersistMs, 30_000) }),
      ...(event.contentState === "ready" || event.contentState === "loading" || event.contentState === "unavailable"
        ? { contentState: event.contentState } : {}),
    };
  }

  if (event.kind === "home-scroll") {
    const frameCount = boundedInteger(event.frameCount, 10_000);
    return {
      schema: OBSERVABILITY_SCHEMA,
      route: event.route,
      level: "info",
      kind: event.kind,
      code: "HOME_SCROLL",
      version: 1,
      cache: event.cache,
      device: event.device,
      ...(HOME_ENGINES.some((engine) => engine === event.engine) ? { engine: event.engine } : {}),
      deployment: sanitizeDeployment(event.deployment),
      durationMs: boundedInteger(event.durationMs, 30_000),
      frameCount,
      slowFrameCount: Math.min(frameCount, boundedInteger(event.slowFrameCount, 10_000)),
      maxFrameMs: boundedInteger(event.maxFrameMs, 5_000),
      ...(event.longFrameCount === undefined || event.longFrameMs === undefined ? {} : {
        longFrameCount: boundedInteger(event.longFrameCount, 1_000),
        longFrameMs: boundedInteger(event.longFrameMs, 30_000),
      }),
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
      ...(event.tokenMs === undefined
        ? {}
        : { tokenMs: boundedInteger(event.tokenMs, 30_000) }),
      ...(event.validationMs === undefined
        ? {}
        : { validationMs: boundedInteger(event.validationMs, 30_000) }),
      ...(event.stalledStage !== undefined && HOME_AUTH_RESTORE_STAGES.includes(event.stalledStage)
        ? { stalledStage: event.stalledStage }
        : {}),
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
      incomplete: normalizeBalancesReadIncomplete(event.incomplete),
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
      valuation: {
        priced: boundedInteger(event.valuation?.priced, 10_000),
        unknownToken: boundedInteger(event.valuation?.unknownToken, 10_000),
        noRecentClose: boundedInteger(event.valuation?.noRecentClose, 10_000),
        quoteUnavailable: boundedInteger(event.valuation?.quoteUnavailable, 10_000),
        fxUnavailable: boundedInteger(event.valuation?.fxUnavailable, 10_000),
      },
    };
  }

  if (event.kind === "upstream-call") {
    const outcome: UpstreamCallOutcome =
      event.outcome === "ok" || event.outcome === "skipped" || event.outcome === "invalid"
        ? event.outcome : "unavailable";
    const method = event["http.request.method"];
    const status = event["http.response.status_code"];
    const errorType = event["error.type"];
    const provider = typeof event.provider === "string" && event.provider
      ? sanitizeIdentifier(event.provider, "unknown").slice(0, 64)
      : undefined;
    return {
      ...base,
      level: outcome === "ok" || outcome === "skipped" ? "info" : "error",
      kind: event.kind,
      code: allowedValue(event.code, UPSTREAM_CALL_CODES, outcome === "ok" ? "UPSTREAM_OK" : "UPSTREAM_TRANSPORT"),
      outcome,
      ...(provider ? { provider } : {}),
      "http.request.method": typeof method === "string" && /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)
        ? method : "_OTHER",
      ...(typeof status === "number" && Number.isSafeInteger(status) && status >= 100 && status <= 599
        ? { "http.response.status_code": status } : {}),
      ...(typeof errorType === "string" && /^(?:aborted|timeout|transport|oversized|invalid_response|[1-5][0-9]{2})$/.test(errorType)
        ? { "error.type": errorType } : {}),
      durationMs: boundedInteger(event.durationMs, 30_000),
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
    const region = event.region && /^[A-Z]{2}$/.test(event.region)
      ? event.region
      : undefined;
    const ownerHash = event.ownerHash &&
      !(event.kind === "funding-order" && (FUNDING_ORDER_LIFECYCLE_CODES as readonly string[]).includes(code)) &&
      /^[a-f0-9]{32}$/.test(event.ownerHash)
      ? event.ownerHash
      : undefined;
    return {
      ...base,
      level: outcome === "unmatched" || outcome === "ok" || outcome === "accepted" || outcome === "ignored" || outcome === "skipped" ||
        (event.kind === "action-reconcile" && outcome === "unavailable")
        ? "info"
        : "error",
      kind: event.kind,
      code,
      outcome,
      ...(provider ? { provider } : {}),
      ...(region ? { region } : {}),
      ...(typeof event.sandbox === "boolean" ? { sandbox: event.sandbox } : {}),
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

function normalizeBalancesReadIncomplete(incomplete: BalancesReadIncomplete): BalancesReadIncomplete {
  return {
    registry: boundedInteger(incomplete.registry, 1),
    catalog: boundedInteger(incomplete.catalog, 1),
    borrow: boundedInteger(incomplete.borrow, 1),
    balanceUnavailable: boundedInteger(incomplete.balanceUnavailable, 10_000),
    valueUnavailable: boundedInteger(incomplete.valueUnavailable, 10_000),
    priceUnavailable: boundedInteger(incomplete.priceUnavailable, 10_000),
    priceStale: boundedInteger(incomplete.priceStale, 10_000),
    fxUnavailable: boundedInteger(incomplete.fxUnavailable, 10_000),
    belowMarketGate: boundedInteger(incomplete.belowMarketGate, 10_000),
    noQuoteCurrency: boundedInteger(incomplete.noQuoteCurrency, 10_000),
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
