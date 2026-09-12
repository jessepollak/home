import { describe, expect, test } from "bun:test";
import { normalizeObservabilityEvent, OBSERVABILITY_SCHEMA } from "./schema";

describe("observability schema", () => {
  test("normalizes client events to a closed, scrubbed schema", () => {
    const line = normalizeObservabilityEvent({
      kind: "client-error",
      route: "/account?token=query-secret#fragment",
      errorName: "TypeError",
      summary: '{"password":"correct horse battery staple"} at https://example.com/x?otp=847291',
    });

    expect(line).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      level: "error",
      kind: "client-error",
      route: "/account",
      code: "CLIENT_ERROR",
      errorName: "TypeError",
      summary: '{"password":"[REDACTED]"} at [URL]',
    });
    const serialized = JSON.stringify(line);
    for (const forbidden of [
      "correct horse battery staple",
      "example.com",
      "847291",
      "query-secret",
      "fragment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("balance source events identify only the degraded stage and provider class", () => {
    const line = normalizeObservabilityEvent({
      kind: "portfolio-balance-source",
      route: "/api/portfolio/valuation?wallet=private#fragment",
      source: "configured-base-rpc",
      stage: "inventory",
      outcome: "incomplete",
      reason: "read-failed",
    });

    expect(line).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      level: "error",
      kind: "portfolio-balance-source",
      route: "/api/portfolio/valuation",
      code: "PORTFOLIO_BALANCE_SOURCE",
      source: "configured-base-rpc",
      stage: "inventory",
      outcome: "incomplete",
      reason: "read-failed",
    });
    expect(JSON.stringify(line)).not.toContain("private");
  });

  test("unhandled server events contain no exception message, stack, digest, headers, or request URL", () => {
    const line = normalizeObservabilityEvent({
      kind: "unhandled-server-error",
      route: "/app/api/session/route?token=nope",
      method: "get",
      errorName: "ProviderError",
      routeType: "route",
    });

    expect(line).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      level: "error",
      kind: "unhandled-server-error",
      route: "/app/api/session/route",
      method: "GET",
      code: "UNHANDLED_SERVER_ERROR",
      errorName: "ProviderError",
      routeType: "route",
    });
  });
});
