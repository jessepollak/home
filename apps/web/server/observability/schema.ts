import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/shared/observability/scrub";

export const OBSERVABILITY_SCHEMA = "home.observability.v2" as const;

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
    };

type ObservabilityLogBase = {
  schema: typeof OBSERVABILITY_SCHEMA;
  level: "error";
  route: string;
};

export type ObservabilityLogLine = ObservabilityLogBase &
  (
    | {
        kind: "unhandled-server-error";
        code: "UNHANDLED_SERVER_ERROR";
        errorName: string;
        method?: string;
        routeType?: string;
      }
    | {
        kind: "client-error";
        code: "CLIENT_ERROR";
        errorName: string;
        summary: string;
      }
    | {
        kind: "portfolio-balance-source";
        code: "PORTFOLIO_BALANCE_SOURCE";
        source: "cdp-token-balances" | "configured-base-rpc";
        stage: "inventory";
        outcome: "incomplete" | "unavailable";
        reason: PortfolioBalanceSourceReason;
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
    level: "error" as const,
    route: sanitizeRoutePath(event.route),
  };

  if (event.kind === "portfolio-balance-source") {
    return {
      ...base,
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
    kind: event.kind,
    code: "UNHANDLED_SERVER_ERROR",
    errorName,
    ...(method ? { method } : {}),
    ...(routeType ? { routeType } : {}),
  };
}
