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

  test("normalizes bounded activity duration and source events without identifiers", () => {
    const line = normalizeObservabilityEvent({
      kind: "activity-read",
      route: "/api/activity?wallet=0x1111111111111111111111111111111111111111",
      outcome: "succeeded",
      source: "cdp-sql",
      durationMs: 6_964.4,
      sourceDurationMs: 6_900.6,
      rowCount: 25,
    });

    expect(line).toEqual({
      schema: OBSERVABILITY_SCHEMA,
      level: "info",
      kind: "activity-read",
      route: "/api/activity",
      code: "ACTIVITY_READ",
      outcome: "succeeded",
      source: "cdp-sql",
      durationMs: 6_964,
      sourceDurationMs: 6_901,
      rowCount: 25,
    });
    expect(JSON.stringify(line)).not.toContain("0x1111111111111111111111111111111111111111");
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
