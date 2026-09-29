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
      valuation: { priced: 1, unknownToken: 1, noRecentClose: 0, quoteUnavailable: 0, fxUnavailable: 0 },
    })).toMatchObject({
      code: "ACTIVITY_READ",
      source: "cdp-address-history",
      rowCount: 2,
      valuation: { priced: 1, unknownToken: 1, noRecentClose: 0, quoteUnavailable: 0, fxUnavailable: 0 },
    });
  });

  test("bounds activity valuation counters and excludes extra or private fields", () => {
    const line = normalizeObservabilityEvent({
      kind: "activity-read",
      route: "/api/activity",
      outcome: "succeeded",
      reason: "primary-source",
      source: "cdp-sql",
      durationMs: 10,
      sourceDurationMs: 8,
      sourceAttemptCount: 1,
      pageCount: 1,
      rowCount: 5,
      valuation: {
        priced: 10_001,
        unknownToken: -1,
        noRecentClose: "private-garbage",
        quoteUnavailable: 2.6,
        fxUnavailable: Infinity,
        tokenAddress: "private-contract",
        amount: "private-amount",
      },
      walletAddress: "private-address",
    } as never);
    expect(line).toHaveProperty("valuation", {
      priced: 10_000,
      unknownToken: 0,
      noRecentClose: 0,
      quoteUnavailable: 3,
      fxUnavailable: 0,
    });
    expect(JSON.stringify(line)).not.toMatch(/private-/);
  });

  test("preserves cache-first balance outcomes and rejects unknown ones", () => {
    const event = {
      kind: "balances-read" as const,
      route: "/api/balances" as const,
      outcome: "revalidating" as const,
      durationMs: { "store-read": 1, enumerate: 0, "registry-read": 0, resolve: 0, price: 1, "valuation-store": 1, codex: 0, coinbase: 0, "store-write": 0, total: 2 },
      coverage: { registry: "complete" as const, catalog: "complete" as const },
      incomplete: {
        registry: 0, catalog: 0, borrow: 0, balanceUnavailable: 0, valueUnavailable: 0,
        priceUnavailable: 2, priceStale: 0, fxUnavailable: 0, belowMarketGate: 0, noQuoteCurrency: 0,
      },
    };
    expect(normalizeObservabilityEvent(event)).toMatchObject({ outcome: "revalidating", incomplete: event.incomplete });
    expect(normalizeObservabilityEvent({ ...event, outcome: "surprise" as never })).toMatchObject({ outcome: "error" });
    expect(normalizeObservabilityEvent({
      ...event,
      incomplete: {
        ...event.incomplete,
        registry: -2, catalog: 4, borrow: Infinity,
        priceUnavailable: 20_000, priceStale: -1, fxUnavailable: Number.NaN,
      },
    })).toMatchObject({
      incomplete: {
        registry: 0, catalog: 1, borrow: 0, priceUnavailable: 10_000, priceStale: 0, fxUnavailable: 0,
      },
    });
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

  test("bounds identity-free interaction logs and sanitizes server deployment", () => {
    expect(normalizeObservabilityEvent({
      version: 1, kind: "home-navigation", route: "/home", from: "/cash", trigger: "history",
      cache: "retained", device: "mobile-low", durationMs: 99_000,
      deployment: "https://private.example/path", address: "private-address",
    } as never)).toEqual({
      schema: "home.observability.v2", level: "info", kind: "home-navigation",
      code: "HOME_NAVIGATION", version: 1, route: "/home", from: "/cash", trigger: "history",
      cache: "retained", device: "mobile-low", durationMs: 10_000,
      deployment: "unknown",
    });
    const scroll = normalizeObservabilityEvent({
      version: 1, kind: "home-scroll", route: "/borrow", cache: "first-visit",
      device: "desktop-high", durationMs: 50_000, frameCount: 3, slowFrameCount: 12,
      maxFrameMs: 6_000, longFrameCount: 2_000, longFrameMs: 40_000,
      deployment: "deploy-42", userAgent: "private-agent",
    } as never);
    expect(scroll).toEqual({
      schema: "home.observability.v2", level: "info", kind: "home-scroll", code: "HOME_SCROLL",
      version: 1, route: "/borrow", cache: "first-visit", device: "desktop-high",
      durationMs: 30_000, frameCount: 3, slowFrameCount: 3, maxFrameMs: 5_000,
      longFrameCount: 1_000, longFrameMs: 30_000, deployment: "deploy-42",
    });
  });

  test("keeps only the closed engine dimension on interaction logs", () => {
    const navigation = { version: 1, kind: "home-navigation", route: "/home", from: "/cash",
      trigger: "history", cache: "retained", device: "mobile-low", durationMs: 20,
      deployment: "local" } as const;
    const scroll = { version: 1, kind: "home-scroll", route: "/cash", cache: "retained",
      device: "desktop-high", durationMs: 400, frameCount: 4, slowFrameCount: 1,
      maxFrameMs: 30, deployment: "local" } as const;
    for (const event of [navigation, scroll]) {
      expect(normalizeObservabilityEvent(event)).not.toHaveProperty("engine");
      for (const engine of ["chromium", "webkit", "gecko", "other"] as const) {
        expect(normalizeObservabilityEvent({ ...event, engine } as never)).toHaveProperty("engine", engine);
      }
      for (const engine of ["private", "", null, undefined]) {
        expect(normalizeObservabilityEvent({ ...event, engine } as never)).not.toHaveProperty("engine");
      }
    }
  });

  test("normalizes non-string deployment on both interaction event kinds", () => {
    const events = [
      {
        version: 1, kind: "home-navigation", route: "/home", from: "/cash",
        trigger: "history", cache: "retained", device: "mobile-low",
        durationMs: 20, deployment: false,
      },
      {
        version: 1, kind: "home-scroll", route: "/cash", cache: "retained",
        device: "desktop-high", durationMs: 400, frameCount: 4,
        slowFrameCount: 1, maxFrameMs: 30, deployment: false,
      },
    ] as const;
    for (const event of events) {
      expect(normalizeObservabilityEvent(event as never))
        .toMatchObject({ kind: event.kind, deployment: "unknown" });
    }
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
      tokenMs: 150,
      validationMs: 850,
      stalledStage: "validation",
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
      tokenMs: 150,
      validationMs: 850,
      stalledStage: "validation",
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
    const sanitized = normalizeObservabilityEvent({
      version: 1,
      kind: "home-auth-phase",
      route: "/",
      flow: "restore",
      hint: "none",
      outcome: "timeout",
      tokenMs: -10,
      validationMs: 50_000,
      stalledStage: "private-stage",
      sessionSettledMs: 15_000,
      totalMs: 15_000,
      identity: "private-identity",
    } as never);
    expect(sanitized).toMatchObject({ tokenMs: 0, validationMs: 30_000 });
    expect(sanitized).not.toHaveProperty("stalledStage");
    expect(JSON.stringify(sanitized)).not.toContain("private-");
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
    "FUNDING_BINDING_ENVIRONMENT_MISSING",
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

  test("keeps funding lifecycle events on the exact privacy allowlist", () => {
    const event = normalizeObservabilityEvent({
      kind: "funding-order",
      route: "/api/funding/orders/:id",
      code: "ORDER_RECEIVED",
      outcome: "ok",
      provider: "ripio",
      region: "BR",
      sandbox: false,
      durationMs: 12,
      ownerHash: "a".repeat(32),
      orderId: "private-order",
      providerTransactionId: "private-transaction",
      transactionHash: `0x${"1".repeat(64)}`,
      destination: "0x1111111111111111111111111111111111111111",
      amount: "100.00",
      kyc: "private-kyc",
      paymentInstructions: "private-instructions",
      providerStatus: "private-status",
      providerError: "private-error",
      rawPayload: "private-payload",
    } as never);

    expect(event).toEqual({
      schema: "home.observability.v2",
      route: "/api/funding/orders/:redacted",
      level: "info",
      kind: "funding-order",
      code: "ORDER_RECEIVED",
      outcome: "ok",
      provider: "ripio",
      region: "BR",
      sandbox: false,
      durationMs: 12,
    });
    const lifecycle = { ...event } as Record<string, unknown>;
    expect(lifecycle).not.toHaveProperty("ownerHash");
    expect(Object.keys(lifecycle).sort()).toEqual([
      "code", "durationMs", "kind", "level", "outcome", "provider", "region", "route", "sandbox", "schema",
    ].sort());
    expect(typeof lifecycle.sandbox).toBe("boolean");
    expect(JSON.stringify(lifecycle)).not.toMatch(/private|0x1111/);
  });

  test("omits non-boolean sandbox values", () => {
    expect(normalizeObservabilityEvent({
      kind: "funding-order",
      route: "/api/funding/orders",
      code: "ORDER_CREATED",
      outcome: "ok",
      sandbox: "yes",
      durationMs: 1,
    } as never)).not.toHaveProperty("sandbox");
  });

  test("allows only closed user token diagnostics without credential fields", () => {
    for (const code of ["USER_TOKEN_KEY_UNAVAILABLE", "USER_TOKEN_EXPIRED", "USER_TOKEN_UNREADABLE", "USER_TOKEN_PRESERVED_UNREADABLE", "USER_TOKEN_CAPTURE_CONFLICT", "USER_TOKEN_STORE_FAILURE", "USER_TOKEN_CLEARED_AFTER_REJECTION", "USER_TOKEN_REJECTION_CLEAR_CONFLICT", "USER_TOKEN_CAPTURED"]) {
      const event = normalizeObservabilityEvent({ kind: "funding-order", route: "/api/funding/orders", code, outcome: "ok", provider: "coinbase", region: "US", sandbox: true, durationMs: 0 });
      expect(event.code).toBe(code);
      expect(Object.keys(event).sort()).toEqual(["code", "durationMs", "kind", "level", "outcome", "provider", "region", "route", "sandbox", "schema"].sort());
    }
    expect(normalizeObservabilityEvent({ kind: "funding-order", route: "/api/funding/orders", code: "USER_TOKEN_PRIVATE", outcome: "unavailable", durationMs: 0 }).code).toBe("ORDER_UNAVAILABLE");
  });

  test.each([
    ["success", "UPSTREAM_OK", "ok", "POST", 200, undefined, "info"],
    ["timeout", "UPSTREAM_TIMEOUT", "unavailable", "GET", undefined, "timeout", "error"],
    ["invalid", "UPSTREAM_INVALID_RESPONSE", "invalid", "GET", 200, "invalid_response", "error"],
    ["HTTP 503", "UPSTREAM_HTTP_5XX", "unavailable", "GET", 503, "503", "error"],
  ] as const)("normalizes %s upstream call", (_label, code, outcome, method, status, errorType, level) => {
    const line = normalizeObservabilityEvent({
      kind: "upstream-call", route: "/api/funding/orders", code, outcome,
      "http.request.method": method,
      ...(status === undefined ? {} : { "http.response.status_code": status }),
      ...(errorType === undefined ? {} : { "error.type": errorType }),
      durationMs: 31_000,
    });
    expect(line).toEqual({
      schema: "home.observability.v2", kind: "upstream-call", route: "/api/funding/orders",
      code, outcome, level, "http.request.method": method,
      ...(status === undefined ? {} : { "http.response.status_code": status }),
      ...(errorType === undefined ? {} : { "error.type": errorType }),
      durationMs: 30_000,
    });
  });

  test("drops upstream private fields and scrubs route, method, provider and error type", () => {
    const line = normalizeObservabilityEvent({
      kind: "upstream-call", route: "/api/funding/orders/:private-secret?token=private-query",
      code: "UPSTREAM_TRANSPORT", outcome: "unavailable", provider: "private-provider@secret",
      "http.request.method": "GET /v1?private-token", "error.type": "POST private-secret",
      "http.response.status_code": 200, durationMs: 2,
      ["author" + "ization"]: "private-auth", url: "https://example.test/?token=private-query",
      headers: { token: "private-header" }, body: "private-body", token: "private-token",
    } as never);
    expect(line).toMatchObject({
      route: "/api/funding/orders/:redacted", provider: "unknown",
      "http.request.method": "_OTHER", code: "UPSTREAM_TRANSPORT",
    });
    expect(Object.hasOwn(line, "error.type")).toBe(false);
    expect(Object.keys(line).sort()).toEqual([
      "schema", "level", "kind", "route", "code", "outcome", "provider",
      "http.request.method", "http.response.status_code", "durationMs",
    ].sort());
    expect(JSON.stringify(line)).not.toContain("private-");
  });

  test.each([
    ["ok", "UPSTREAM_OK"],
    ["unavailable", "UPSTREAM_TRANSPORT"],
  ] as const)("falls back to closed upstream code for %s", (outcome, code) => {
    const line = normalizeObservabilityEvent({
      kind: "upstream-call", route: "/api/funding/orders", code: "PRIVATE_CODE", outcome,
      "http.request.method": "POST private-token", "http.response.status_code": 600,
      "error.type": "private-error", durationMs: -2,
    } as never);
    expect(line).toMatchObject({ code, "http.request.method": "_OTHER", durationMs: 0 });
    expect(Object.hasOwn(line, "http.response.status_code")).toBe(false);
    expect(Object.hasOwn(line, "error.type")).toBe(false);
  });

  test.each([99, 599, 100.5, Number.NaN, Number.MAX_SAFE_INTEGER, "200"])(
    "keeps upstream HTTP status only for safe 100..599 integers (%s)", (status) => {
      const line = normalizeObservabilityEvent({
        kind: "upstream-call", route: "/api/funding/orders", code: "UPSTREAM_HTTP_5XX",
        outcome: "unavailable", "http.request.method": "GET",
        "http.response.status_code": status, durationMs: 0,
      } as never);
      if (status === 599) expect(line).toMatchObject({ "http.response.status_code": 599 });
      else expect(Object.hasOwn(line, "http.response.status_code")).toBe(false);
    },
  );

  test.each([
    ["UPSTREAM_ABORTED", "skipped", "info"],
    ["UPSTREAM_TIMEOUT", "unavailable", "error"],
    ["UPSTREAM_TRANSPORT", "unavailable", "error"],
    ["UPSTREAM_HTTP_3XX", "unavailable", "error"],
    ["UPSTREAM_HTTP_4XX", "unavailable", "error"],
    ["UPSTREAM_HTTP_5XX", "unavailable", "error"],
    ["UPSTREAM_OVERSIZED", "unavailable", "error"],
    ["UPSTREAM_INVALID_RESPONSE", "invalid", "error"],
  ] as const)("preserves upstream code %s with the expected outcome and level", (code, outcome, level) => {
    expect(normalizeObservabilityEvent({
      kind: "funding-order", route: "/api/funding/orders", code, outcome, durationMs: 2,
    })).toEqual({
      schema: "home.observability.v2", kind: "funding-order", route: "/api/funding/orders",
      code, outcome, level, durationMs: 2,
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
