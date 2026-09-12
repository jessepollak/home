import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";

export const OBSERVABILITY_SCHEMA = "home.observability.v2" as const;

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
      outcome: "succeeded" | "failed";
      source: "cdp-sql";
      durationMs: number;
      sourceDurationMs: number;
      rowCount: number;
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
  outcome?: "succeeded" | "failed";
  source?: "cdp-sql";
  durationMs?: number;
  sourceDurationMs?: number;
  rowCount?: number;
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
    return {
      schema: OBSERVABILITY_SCHEMA,
      level: event.outcome === "succeeded" ? "info" : "error",
      kind: event.kind,
      route,
      code: "ACTIVITY_READ",
      outcome: event.outcome,
      source: event.source,
      durationMs: boundedInteger(event.durationMs, 60_000),
      sourceDurationMs: boundedInteger(event.sourceDurationMs, 60_000),
      rowCount: boundedInteger(event.rowCount, 10_000),
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
