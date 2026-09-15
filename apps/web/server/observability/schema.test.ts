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

  test("normalizes closed auth restore events at the expected level", () => {
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-auth-phase",
      route: "/",
      flow: "restore",
      hint: "none",
      outcome: "signed-out",
      sdkActivateMs: 150,
      nativeSettledMs: 950,
      sessionSettledMs: 1_000,
      totalMs: 1_000,
    })).toEqual({
      schema: "home.observability.v2",
      level: "info",
      kind: "home-auth-phase",
      code: "HOME_AUTH_PHASE",
      version: 1,
      route: "/",
      flow: "restore",
      hint: "none",
      outcome: "signed-out",
      sdkActivateMs: 150,
      nativeSettledMs: 950,
      sessionSettledMs: 1_000,
      totalMs: 1_000,
    });
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-auth-phase",
      route: "/dashboard",
      flow: "restore",
      hint: "cdp",
      outcome: "timeout",
      sessionSettledMs: 15_000,
      totalMs: 15_000,
    })).toMatchObject({ level: "error", code: "HOME_AUTH_PHASE" });
  });

  test.each([
    "FUNDING_SANDBOX_MIGRATION_REQUIRED",
    "OFFRAMP_DISCOVERY_CONFIGURATION",
    "OFFRAMP_DISCOVERY_PROVIDER",
  ])("preserves the scrubbed closed funding diagnostic %s", (code) => {
    expect(normalizeObservabilityEvent({
      kind: "funding-order",
      route: "/api/funding/providers",
      code,
      outcome: "unavailable",
      durationMs: 1,
    })).toEqual({
      schema: "home.observability.v2",
      level: "error",
      kind: "funding-order",
      route: "/api/funding/providers",
      code,
      outcome: "unavailable",
      durationMs: 1,
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
