import { describe, expect, test } from "bun:test";
import { normalizeObservabilityEvent } from "./schema";

describe("observability schema", () => {
  test("preserves the staged Address History activity source", () => {
    expect(normalizeObservabilityEvent({
      kind: "activity-read",
      route: "/api/activity",
      outcome: "succeeded",
      reason: "primary-source",
      source: "cdp-address-history",
      durationMs: 10,
      sourceDurationMs: 8,
      sourceAttemptCount: 1,
      pageCount: 1,
      rowCount: 2,
    })).toMatchObject({
      code: "ACTIVITY_READ",
      source: "cdp-address-history",
      rowCount: 2,
    });
  });

  test("preserves cache-first balance outcomes and rejects unknown ones", () => {
    const event = {
      kind: "balances-read" as const,
      route: "/api/balances" as const,
      outcome: "revalidating" as const,
      durationMs: { "store-read": 1, enumerate: 0, "registry-read": 0, resolve: 0, price: 1, "valuation-store": 1, codex: 0, coinbase: 0, "store-write": 0, total: 2 },
      coverage: { registry: "complete" as const, catalog: "complete" as const },
    };
    expect(normalizeObservabilityEvent(event)).toMatchObject({ outcome: "revalidating" });
    expect(normalizeObservabilityEvent({ ...event, outcome: "surprise" as never })).toMatchObject({ outcome: "error" });
  });
  test("normalizes closed Home startup events at the expected level", () => {
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-startup",
      route: "/home",
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
      route: "/home",
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
      route: "/home",
      flow: "restore",
      hint: "cdp",
      outcome: "timeout",
      sessionSettledMs: 15_000,
      totalMs: 15_000,
    })).toMatchObject({ level: "error", code: "HOME_AUTH_PHASE" });
  });

  test("normalizes closed auth signout events with fixed attempts and timings", () => {
    expect(normalizeObservabilityEvent({
      version: 1,
      kind: "home-auth-phase",
      route: "/home",
      flow: "signout",
      outcome: "success",
      visibleNavigationMs: 50,
      nativeLogoutAttempted: true,
      nativeLogoutMs: 100,
      walletDisconnectAttempted: false,
      cdpSignOutAttempted: true,
      cdpSignOutMs: 250,
      totalMs: 300,
    })).toMatchObject({
      schema: "home.observability.v2",
      code: "HOME_AUTH_PHASE",
      level: "info",
      flow: "signout",
      outcome: "success",
      nativeLogoutAttempted: true,
      cdpSignOutAttempted: true,
      totalMs: 300,
    });
  });

  test.each([
    "FUNDING_PROVIDER_CONFIGURATION",
    "PROVIDER_INVALID_RESPONSE",
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

  test("emits a matched webhook with only the scrubbed provider and verified region", () => {
    const event = normalizeObservabilityEvent({
      kind: "funding-webhook",
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_MATCHED",
      outcome: "accepted",
      provider: "ripio",
      region: "AR",
      durationMs: 2,
      providerOrderId: "private-order-id",
      rawBody: "private-body",
    } as never);
    expect(event).toEqual({
      schema: "home.observability.v2",
      route: "/api/funding/webhooks/:redacted",
      level: "info",
      kind: "funding-webhook",
      code: "WEBHOOK_MATCHED",
      outcome: "accepted",
      provider: "ripio",
      region: "AR",
      durationMs: 2,
    });
    expect(JSON.stringify(event)).not.toContain("private-order-id");
    expect(JSON.stringify(event)).not.toContain("private-body");
    expect(normalizeObservabilityEvent({
      kind: "funding-webhook",
      route: "/api/funding/webhooks/:provider",
      code: "WEBHOOK_MATCHED",
      outcome: "accepted",
      provider: "ripio",
      region: "AR/private",
      durationMs: 2,
    })).not.toHaveProperty("region");
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
