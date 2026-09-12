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

export type ObservabilityLogLine = {
  schema: typeof OBSERVABILITY_SCHEMA;
  level: "error" | "info";
  kind: ObservabilityEvent["kind"];
  route: string;
  method?: string;
  code: "UNHANDLED_SERVER_ERROR" | "CLIENT_ERROR" | "ACTIVITY_READ";
  errorName?: string;
  routeType?: string;
  summary?: string;
  outcome?: ActivityReadOutcome;
  reason?: ActivityReadReason;
  source?: ActivityReadSource;
  durationMs?: number;
  sourceDurationMs?: number;
  sourceAttemptCount?: number;
  pageCount?: number;
  rowCount?: number;
  recordedOperations?: ActivityRecordedOperationsState;
};

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
  const route = sanitizeRoutePath(event.route);
  if (event.kind === "activity-read") {
    const outcome = allowedValue(event.outcome, ACTIVITY_READ_OUTCOMES, "failed");
    return {
      schema: OBSERVABILITY_SCHEMA,
      level:
        outcome === "failed" || outcome === "cancelled" ? "error" : "info",
      kind: event.kind,
      route,
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

  const base = {
    schema: OBSERVABILITY_SCHEMA,
    level: "error" as const,
    kind: event.kind,
    route,
    code:
      event.kind === "client-error"
        ? ("CLIENT_ERROR" as const)
        : ("UNHANDLED_SERVER_ERROR" as const),
    errorName: sanitizeIdentifier(event.errorName ?? "Error", "Error"),
  };

  if (event.kind === "client-error") {
    return {
      ...base,
      summary: scrubString(event.summary).trim().slice(0, 256) || "Client error",
    };
  }

  const method = sanitizeMethod(event.method);
  const routeType = event.routeType
    ? sanitizeIdentifier(event.routeType, "unknown").slice(0, 32)
    : undefined;

  return {
    ...base,
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
