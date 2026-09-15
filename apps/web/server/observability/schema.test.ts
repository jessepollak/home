import { describe, expect, test } from "bun:test";
import { normalizeObservabilityEvent } from "./schema";

describe("observability schema", () => {
  test("normalizes closed Home startup events at the expected level", () => {
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-startup",
      route: "/dashboard",
      outcome: "ready",
      cache: "cold",
      shellMs: 1,
      balancesMs: 2,
      sessionMs: 3,
      interactiveMs: 4,
      totalMs: 4,
    })).toEqual({
      schema: "home.observability.v2",
      level: "info",
      kind: "home-startup",
      code: "HOME_STARTUP",
      version: 1,
      route: "/dashboard",
      outcome: "ready",
      cache: "cold",
      shellMs: 1,
      balancesMs: 2,
      sessionMs: 3,
      interactiveMs: 4,
      totalMs: 4,
    });
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-startup",
      route: "/",
      outcome: "timeout",
      cache: "unknown",
      shellMs: 1,
      totalMs: 15_000,
    })).toMatchObject({ level: "error", code: "HOME_STARTUP" });
  });

  test("preserves the scrubbed funding sandbox migration diagnostic", () => {
    expect(normalizeObservabilityEvent({
      kind: "funding-order",
      route: "/api/funding/providers",
      code: "FUNDING_SANDBOX_MIGRATION_REQUIRED",
      outcome: "unavailable",
      durationMs: 1,
    })).toMatchObject({
      kind: "funding-order",
      code: "FUNDING_SANDBOX_MIGRATION_REQUIRED",
      outcome: "unavailable",
    });
  });

  test("normalizes out-of-enum funding-order codes to ORDER_UNAVAILABLE", () => {
    expect(normalizeObservabilityEvent({
      kind: "funding-order",
      route: "/funding/providers/fixture",
      code: "PROVIDER_PRIVATE_ERROR",
      outcome: "unavailable",
      provider: "fixture",
      durationMs: 12,
    })).toMatchObject({
      kind: "funding-order",
      code: "ORDER_UNAVAILABLE",
      outcome: "unavailable",
      provider: "fixture",
    });
  });
});
