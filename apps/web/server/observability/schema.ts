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
    };

export type ObservabilityLogLine = {
  schema: typeof OBSERVABILITY_SCHEMA;
  level: "error";
  kind: ObservabilityEvent["kind"];
  route: string;
  method?: string;
  code: "UNHANDLED_SERVER_ERROR" | "CLIENT_ERROR";
  errorName: string;
  routeType?: string;
  summary?: string;
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
  const base = {
    schema: OBSERVABILITY_SCHEMA,
    level: "error" as const,
    kind: event.kind,
    route: sanitizeRoutePath(event.route),
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
