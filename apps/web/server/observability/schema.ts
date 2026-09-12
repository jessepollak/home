import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";

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
export const ACTIVITY_RECORDED_OPERATIONS_STATES = [
  "not-started",
  "available",
  "unavailable",
] as const;

export type ActivityReadOutcome = (typeof ACTIVITY_READ_OUTCOMES)[number];
export type ActivityReadReason = (typeof ACTIVITY_READ_REASONS)[number];
export type ActivityReadSource = (typeof ACTIVITY_READ_SOURCES)[number];
export type ActivityRecordedOperationsState =
  (typeof ACTIVITY_RECORDED_OPERATIONS_STATES)[number];

export type PortfolioBalanceSourceReason =
  | "not-configured"
  | "unauthorized"
  | "rate-limited"
  | "timed-out"
  | "upstream-error"
  | "invalid-response"
  | "partial"
  | "read-failed";

export type ObservabilityEvent =
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
      route: string;
      source: "cdp-token-balances" | "configured-base-rpc";
      stage: "inventory";
      outcome: "incomplete" | "unavailable";
      reason: PortfolioBalanceSourceReason;
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
      recordedOperations: ActivityRecordedOperationsState;
    };

type ObservabilityLogBase = {
  schema: typeof OBSERVABILITY_SCHEMA;
  route: string;
};

export type ObservabilityLogLine = ObservabilityLogBase &
  (
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
        recordedOperations: ActivityRecordedOperationsState;
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
      recordedOperations: allowedValue(
        event.recordedOperations,
        ACTIVITY_RECORDED_OPERATIONS_STATES,
        "not-started",
      ),
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
