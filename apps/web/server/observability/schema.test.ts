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

  test("normalizes bounded closed-schema activity events without identifiers", () => {
    const line = normalizeObservabilityEvent({
      kind: "activity-read",
      route: "/api/activity?wallet=0x1111111111111111111111111111111111111111",
      outcome: "succeeded",
      reason: "primary-source",
      source: "cdp-sql",
      durationMs: 6_964.4,
      sourceDurationMs: 6_900.6,
      sourceAttemptCount: 1,
      pageCount: 1,
      rowCount: 25,
      recordedOperations: "unavailable",
    });

    expect(line).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      level: "info",
      kind: "activity-read",
      route: "/api/activity",
      code: "ACTIVITY_READ",
      outcome: "succeeded",
      reason: "primary-source",
      source: "cdp-sql",
      durationMs: 6_964,
      sourceDurationMs: 6_901,
      sourceAttemptCount: 1,
      pageCount: 1,
      rowCount: 25,
      recordedOperations: "unavailable",
    });
    expect(JSON.stringify(line)).not.toContain(
      "0x1111111111111111111111111111111111111111",
    );
  });

  test("bounds activity counts and falls closed for non-enum runtime values", () => {
    const line = normalizeObservabilityEvent({
      kind: "activity-read",
      route: "/api/activity",
      outcome: "private-owner" as never,
      reason: "raw-error" as never,
      source: "secret-provider" as never,
      durationMs: Number.POSITIVE_INFINITY,
      sourceDurationMs: -50,
      sourceAttemptCount: 999,
      pageCount: 999,
      rowCount: 999_999,
      recordedOperations: "database-error" as never,
    });

    expect(line).toMatchObject({
      level: "error",
      outcome: "failed",
      reason: "none",
      source: "none",
      durationMs: 0,
      sourceDurationMs: 0,
      sourceAttemptCount: 10,
      pageCount: 10,
      rowCount: 10_000,
      recordedOperations: "not-started",
    });
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
