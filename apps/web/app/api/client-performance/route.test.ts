import { describe, expect, test } from "bun:test";
import { parseClientPerformanceReport } from "@/shared/observability/client-performance.contract";
import { normalizeObservabilityEvent, type ObservabilityEvent } from "@/server/observability/schema";
import {
  CLIENT_PERFORMANCE_MAX_BODY_BYTES,
  CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW,
  CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW,
  createClientPerformanceHandler,
  createClientPerformancePermits,
} from "@/server/observability/client-performance";

const endpoint = "https://home.example/api/client-performance";
const safeHeaders = {
  origin: "https://home.example",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};
const ready = {
  version: 1,
  kind: "home-startup",
  route: "/home",
  outcome: "ready",
  cache: "restored",
  shellMs: 12.4,
  sessionMs: 31.8,
  balancesMs: 20.2,
  interactiveMs: 50,
  totalMs: 50.1,
} as const;
const authReady = {
  version: 1,
  kind: "home-auth-phase",
  route: "/",
  flow: "restore",
  hint: "none",
  outcome: "signed-out",
  sdkActivateMs: 126,
  nativeSettledMs: 974,
  tokenMs: 126,
  validationMs: 974,
  stalledStage: "validation",
  sessionSettledMs: 1_024,
  totalMs: 1_024,
} as const;

const navigation = { version: 1, kind: "home-navigation", route: "/cash", from: "/home",
  cache: "retained", trigger: "in-app", device: "mobile-low", durationMs: 24 } as const;
const scroll = { version: 1, kind: "home-scroll", route: "/cash", cache: "retained",
  device: "desktop-high", durationMs: 401, frameCount: 4, slowFrameCount: 1, maxFrameMs: 29 } as const;

function request(
  body: string | Uint8Array | ReadableStream<Uint8Array>,
  headerValues: Record<string, string> = safeHeaders,
  query?: string,
): Request {
  const normalizedHeaders = new Map(
    Object.entries(headerValues).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const stream = body instanceof ReadableStream
    ? body
    : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(typeof body === "string" ? new TextEncoder().encode(body) : body);
          controller.close();
        },
      });
  const bodyKind = typeof body === "string" ? (() => {
    try { return JSON.parse(body).kind as string | undefined; } catch { return undefined; }
  })() : undefined;
  return {
    url: `${endpoint}?${query ?? `kind=${bodyKind ?? "home-startup"}`}`,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
      has: (name: string) => normalizedHeaders.has(name.toLowerCase()),
    },
    body: stream,
  } as Request;
}

describe("POST /api/client-performance", () => {
  test("budgets startup, auth restore, and occasional signout reports", () => {
    expect(CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW).toBe(60);
  });

  test("normalizes the exact closed startup schema without reordering phases", () => {
    expect(parseClientPerformanceReport(ready)).toEqual({
      ...ready,
      shellMs: 12,
      sessionMs: 32,
      balancesMs: 20,
      totalMs: 50,
    });
    expect(parseClientPerformanceReport({
      ...ready,
      outcome: "timeout",
      shellMs: -5,
      totalMs: 70_000,
    })).toMatchObject({ shellMs: 0, totalMs: 60_000 });

    expect(parseClientPerformanceReport({ ...ready, route: "/investments" }))
      .toMatchObject({ route: "/investments" });
    for (const invalid of [
      null,
      [],
      {},
      { ...ready, extra: "wallet-or-provider" },
      { ...ready, route: "/balances/investments" },
      { ...ready, route: "/investments/native" },
      { ...ready, route: "/home?owner=secret" },
      { ...ready, outcome: "failed" },
      { ...ready, cache: "owner-123" },
      { ...ready, shellMs: "12" },
      { ...ready, sessionMs: undefined },
      { ...ready, totalMs: Number.NaN },
    ]) expect(parseClientPerformanceReport(invalid)).toBeNull();
  });

  test("normalizes and closes the auth restore schema", () => {
    expect(parseClientPerformanceReport(authReady)).toEqual({
      ...authReady,
      sdkActivateMs: 150,
      nativeSettledMs: 950,
      tokenMs: 150,
      validationMs: 950,
      sessionSettledMs: 1_000,
      totalMs: 1_000,
    });
    for (const invalid of [
      { ...authReady, identity: "secret-subject" },
      { ...authReady, hint: "cdp:owner" },
      { ...authReady, outcome: "error" },
      { ...authReady, flow: "email" },
      { ...authReady, route: "/?account=signin" },
      { ...authReady, sessionSettledMs: undefined },
      { ...authReady, cdpInitializedMs: "900" },
      { ...authReady, tokenMs: "100" },
      { ...authReady, validationMs: undefined },
      { ...authReady, stalledStage: "upstream" },
      { ...authReady, stalledStage: undefined },
    ]) expect(parseClientPerformanceReport(invalid)).toBeNull();
    expect(parseClientPerformanceReport({
      ...authReady, tokenMs: -10, validationMs: 40_000, stalledStage: "token",
    })).toMatchObject({ tokenMs: 0, validationMs: 30_000, stalledStage: "token" });
    expect(parseClientPerformanceReport({
      version: 1, kind: "home-auth-phase", route: "/", flow: "restore", hint: "none",
      outcome: "signed-out", sessionSettledMs: 100, totalMs: 100,
    })).toEqual({
      version: 1, kind: "home-auth-phase", route: "/", flow: "restore", hint: "none",
      outcome: "signed-out", sessionSettledMs: 100, totalMs: 100,
    });
  });

  test("normalizes the closed signout schema", () => {
    const signout = {
      version: 1,
      kind: "home-auth-phase",
      route: "/home",
      flow: "signout",
      outcome: "timeout",
      visibleNavigationMs: 12,
      nativeLogoutAttempted: true,
      nativeLogoutMs: 81,
      walletDisconnectAttempted: true,
      walletDisconnectMs: 49,
      cdpSignOutAttempted: true,
      cdpSignOutMs: 2_500,
      totalMs: 2_511,
    } as const;
    expect(parseClientPerformanceReport(signout)).toEqual({
      ...signout,
      visibleNavigationMs: 0,
      nativeLogoutMs: 100,
      walletDisconnectMs: 50,
      totalMs: 2_500,
    });
    expect(parseClientPerformanceReport({ ...signout, provider: "cdp" })).toBeNull();
    expect(parseClientPerformanceReport({ ...signout, cdpSignOutAttempted: "yes" })).toBeNull();
    expect(parseClientPerformanceReport({ ...signout, tokenMs: 100 })).toBeNull();
    expect(parseClientPerformanceReport({ ...signout, stalledStage: "token" })).toBeNull();
  });

  test("enforces same-origin, JSON-only, no-encoding, bounded body, and rate shedding", async () => {
    const handler = createClientPerformanceHandler({ takePermit: () => true });
    expect((await handler(request(JSON.stringify(ready), { ...safeHeaders, origin: "https://evil.example" }))).status).toBe(403);
    expect((await handler(request(JSON.stringify(ready), { ...safeHeaders, "content-type": "text/plain" }))).status).toBe(415);
    expect((await handler(request(JSON.stringify(ready), { ...safeHeaders, "content-encoding": "gzip" }))).status).toBe(415);
    expect((await handler(request("{", safeHeaders))).status).toBe(400);
    expect((await handler(request(new Uint8Array([0xc3, 0x28])))).status).toBe(400);
    expect((await handler(request("{}", {
      ...safeHeaders,
      "content-length": String(CLIENT_PERFORMANCE_MAX_BODY_BYTES + 1),
    }))).status).toBe(413);
    expect((await createClientPerformanceHandler({ takePermit: () => false })(
      request(JSON.stringify(ready)),
    )).status).toBe(429);
  });

  test("interaction flood cannot consume startup budget, and reporting cannot consume interaction budget", async () => {
    let now = 1_000;
    const handler = createClientPerformanceHandler({
      takePermit: createClientPerformancePermits(() => now), log: () => {},
    });
    for (let i = 0; i < CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW + 5; i++) {
      const response = await handler(request(JSON.stringify(i % 2 === 0 ? navigation : scroll)));
      expect(response.status).toBe(i < CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW ? 204 : 429);
      if (i >= CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW) expect(response.headers.get("retry-after")).toBe("60");
    }
    expect((await handler(request(JSON.stringify(ready)))).status).toBe(204);
    expect((await handler(request(JSON.stringify(authReady)))).status).toBe(204);
    for (let i = 2; i < CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW; i++) {
      expect((await handler(request(JSON.stringify(ready)))).status).toBe(204);
    }
    expect((await handler(request(JSON.stringify(ready)))).status).toBe(429);
    now += 60_000;
    expect((await handler(request(JSON.stringify(navigation)))).status).toBe(204);
    expect((await handler(request(JSON.stringify(ready)))).status).toBe(204);
  });

  test("reporting flood leaves interaction capacity available", async () => {
    const handler = createClientPerformanceHandler({
      takePermit: createClientPerformancePermits(() => 1_000), log: () => {},
    });
    for (let i = 0; i < CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW; i++) {
      expect((await handler(request(JSON.stringify(ready)))).status).toBe(204);
    }
    expect((await handler(request(JSON.stringify(authReady)))).status).toBe(429);
    expect((await handler(request(JSON.stringify(navigation)))).status).toBe(204);
  });

  test("rejects unknown, absent, and duplicate kind without reading body or taking a permit", async () => {
    for (const query of ["", "kind=unknown", "kind=home-startup&kind=home-scroll"]) {
      let pulls = 0;
      let cancelled = false;
      let permits = 0;
      const body = new ReadableStream<Uint8Array>({
        pull() { pulls += 1; },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      const response = await createClientPerformanceHandler({
        takePermit: () => { permits += 1; return true; },
        log: () => { throw new Error("must not log"); },
      })(request(body, safeHeaders, query));
      expect(response.status).toBe(400);
      expect(pulls).toBe(0);
      expect(cancelled).toBe(true);
      expect(permits).toBe(0);
    }
  });

  test("over-limit request is cancelled without reading its body", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() { pulls += 1; },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const response = await createClientPerformanceHandler({ takePermit: () => false })(
      request(body, safeHeaders, "kind=home-navigation"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(pulls).toBe(0);
    expect(cancelled).toBe(true);
  });

  test("mismatched query and body kinds are rejected after admission without logging", async () => {
    const buckets: string[] = [];
    const events: ObservabilityEvent[] = [];
    const handler = createClientPerformanceHandler({
      takePermit: (bucket) => { buckets.push(bucket); return true; },
      log: (event) => { events.push(event); },
    });
    expect((await handler(request(JSON.stringify(navigation), safeHeaders, "kind=home-startup"))).status).toBe(400);
    expect((await handler(request(JSON.stringify(ready), safeHeaders, "kind=home-navigation"))).status).toBe(400);
    expect(buckets).toEqual(["reporting", "interaction"]);
    expect(events).toEqual([]);
  });

  test("logs only the typed event with no identity or arbitrary data", async () => {
    const events: ObservabilityEvent[] = [];
    const response = await createClientPerformanceHandler({
      takePermit: () => true,
      log: (event) => events.push(event),
    })(request(JSON.stringify(ready)));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(events).toEqual([{
      ...ready,
      shellMs: 12,
      sessionMs: 32,
      balancesMs: 20,
      totalMs: 50,
    }]);
    expect(JSON.stringify(events)).not.toMatch(/owner|wallet|subject|provider|secret|query|hash/i);
  });

  test("passes bounded restore stage timings and the closed stalled stage to the log", async () => {
    const events: ObservabilityEvent[] = [];
    const handler = createClientPerformanceHandler({
      takePermit: () => true,
      log: (event) => events.push(event),
    });
    expect((await handler(request(JSON.stringify(authReady)))).status).toBe(204);
    expect(events).toEqual([{
      ...authReady,
      sdkActivateMs: 150,
      nativeSettledMs: 950,
      tokenMs: 150,
      validationMs: 950,
      sessionSettledMs: 1_000,
      totalMs: 1_000,
    }]);
    expect((await handler(request(JSON.stringify({ ...authReady, stalledStage: "unknown" })))).status).toBe(400);
    expect(events).toHaveLength(1);
  });

  test("stamps deployment on interaction reports only and rejects client deployment", async () => {
    const events: ObservabilityEvent[] = [];
    const handler = createClientPerformanceHandler({
      deployment: "deploy-123", takePermit: () => true, log: (event) => events.push(event),
    });
    expect((await handler(request(JSON.stringify({ ...navigation, engine: "webkit" })))).status).toBe(204);
    expect((await handler(request(JSON.stringify(scroll)))).status).toBe(204);
    expect(events).toEqual([
      { ...navigation, engine: "webkit", durationMs: 20, deployment: "deploy-123" },
      { ...scroll, durationMs: 400, maxFrameMs: 30, deployment: "deploy-123" },
    ]);
    expect((await handler(request(JSON.stringify({ ...navigation, deployment: "client" })))).status).toBe(400);
    expect((await handler(request(JSON.stringify({ ...scroll, address: "private" })))).status).toBe(400);
    expect(events).toHaveLength(2);
    expect(normalizeObservabilityEvent({ ...events[0]!, deployment: "https://private.example/path" } as never))
      .toMatchObject({ level: "info", code: "HOME_NAVIGATION", deployment: "unknown" });
    expect(normalizeObservabilityEvent(events[1]!)).toMatchObject({ level: "info", code: "HOME_SCROLL" });
  });

  test("stamps the server deployment without a dependency override", async () => {
    const previousDeploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    const previousNextDeploymentId = process.env.NEXT_DEPLOYMENT_ID;
    const lines: ReturnType<typeof normalizeObservabilityEvent>[] = [];
    const handler = createClientPerformanceHandler({
      takePermit: () => true,
      log: (event) => { lines.push(normalizeObservabilityEvent(event)); },
    });
    const navigation = {
      version: 1, kind: "home-navigation", route: "/cash", from: "/home",
      cache: "retained", trigger: "in-app", device: "mobile-low", durationMs: 24,
    } as const;
    try {
      process.env.NEXT_DEPLOYMENT_ID = "dpl_stale";
      delete process.env.VERCEL_DEPLOYMENT_ID;
      expect((await handler(request(JSON.stringify(navigation)))).status).toBe(204);
      expect(lines.at(-1)).toMatchObject({ kind: "home-navigation", deployment: "local" });

      process.env.VERCEL_DEPLOYMENT_ID = "";
      expect((await handler(request(JSON.stringify(navigation)))).status).toBe(204);
      expect(lines.at(-1)).toMatchObject({ kind: "home-navigation", deployment: "local" });

      process.env.VERCEL_DEPLOYMENT_ID = "dpl_abc";
      expect((await handler(request(JSON.stringify(navigation)))).status).toBe(204);
      expect(lines.at(-1)).toMatchObject({ kind: "home-navigation", deployment: "dpl_abc" });
      expect(lines).toHaveLength(3);
    } finally {
      if (previousDeploymentId === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
      else process.env.VERCEL_DEPLOYMENT_ID = previousDeploymentId;
      if (previousNextDeploymentId === undefined) delete process.env.NEXT_DEPLOYMENT_ID;
      else process.env.NEXT_DEPLOYMENT_ID = previousNextDeploymentId;
    }
  });

  test("sink failures cannot change a successful ingestion response", async () => {
    const response = await createClientPerformanceHandler({
      takePermit: () => true,
      log: () => { throw new Error("sink failed"); },
    })(request(JSON.stringify(ready)));
    expect(response.status).toBe(204);
  });
});
