import { describe, expect, test } from "bun:test";
import { parseClientPerformanceReport } from "@/shared/observability/client-performance.contract";
import type { ObservabilityEvent } from "@/server/observability/schema";
import {
  CLIENT_PERFORMANCE_MAX_BODY_BYTES,
  createClientPerformanceHandler,
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
  route: "/dashboard",
  outcome: "ready",
  cache: "restored",
  shellMs: 12.4,
  sessionMs: 31.8,
  balancesMs: 20.2,
  interactiveMs: 50,
  totalMs: 50.1,
} as const;

function request(
  body: string | Uint8Array | ReadableStream<Uint8Array>,
  headerValues: Record<string, string> = safeHeaders,
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
  return {
    url: endpoint,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
      has: (name: string) => normalizedHeaders.has(name.toLowerCase()),
    },
    body: stream,
  } as Request;
}

describe("POST /api/client-performance", () => {
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

    for (const invalid of [
      null,
      [],
      {},
      { ...ready, extra: "wallet-or-provider" },
      { ...ready, route: "/activity" },
      { ...ready, route: "/dashboard?owner=secret" },
      { ...ready, outcome: "failed" },
      { ...ready, cache: "owner-123" },
      { ...ready, shellMs: "12" },
      { ...ready, sessionMs: undefined },
      { ...ready, totalMs: Number.NaN },
    ]) expect(parseClientPerformanceReport(invalid)).toBeNull();
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

  test("sink failures cannot change a successful ingestion response", async () => {
    const response = await createClientPerformanceHandler({
      takePermit: () => true,
      log: () => { throw new Error("sink failed"); },
    })(request(JSON.stringify(ready)));
    expect(response.status).toBe(204);
  });
});
