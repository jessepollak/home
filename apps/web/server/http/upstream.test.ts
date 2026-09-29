import { afterEach, describe, expect, test } from "bun:test";
import { setObservabilityLogWriterForTests } from "@/server/observability/log";
import { createUpstreamDeadline, upstreamRequest } from "./upstream";

type ManualClock = ReturnType<typeof manualClock>;

function manualClock() {
  let time = 0;
  const timers: { ms: number; controller: AbortController }[] = [];
  return {
    now: () => time,
    timeout: (ms: number) => {
      const controller = new AbortController();
      timers.push({ ms, controller });
      return controller.signal;
    },
    advance: (ms: number) => { time += ms; },
    expire: (index = 0) => { timers[index]?.controller.abort(); },
    budgets: () => timers.map(({ ms }) => ms),
  };
}

function requestOptions(clock: ManualClock, fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return { deadline: createUpstreamDeadline({ timeoutMs: 100, clock }), maxBytes: 32, fetchImpl };
}

function bodyResponse(stream: ReadableStream<Uint8Array>, headers?: HeadersInit) {
  return new Response(stream, { headers });
}

const url = "https://example.test/path?token=private-query";

afterEach(() => setObservabilityLogWriterForTests());

describe("upstream request", () => {
  test("parses successful bounded JSON through the validator and sets safe fetch defaults", async () => {
    const clock = manualClock();
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    let init: RequestInit | undefined;
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async (_input, options) => {
        init = options;
        clock.advance(7);
        return new Response('{"count":3}', { headers: { "content-type": "application/json" } });
      }),
      parse: (value) => {
        if (typeof value !== "object" || value === null || !("count" in value) || value.count !== 3) throw new Error("bad count");
        return { count: value.count };
      },
    });
    expect(result).toMatchObject({ ok: true, status: 200, value: { count: 3 }, durationMs: 7 });
    expect(result.ok && result.value.count).toBe(3);
    expect(result.ok && result.headers.get("content-type")).toBe("application/json");
    expect(init).toMatchObject({ redirect: "manual", cache: "no-store", signal: expect.any(AbortSignal) });
    expect(lines).toEqual([]);
  });

  test("logs a successful POST once without request URL, query, or body", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async () => { clock.advance(7); return new Response('{"ok":true}'); }),
      init: { method: "post", body: "private-body" },
      log: { route: "/api/funding/orders" },
    });
    expect(result).toMatchObject({ ok: true, status: 200, durationMs: 7 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code: "UPSTREAM_OK", outcome: "ok", level: "info",
      "http.request.method": "POST", "http.response.status_code": 200, durationMs: 7,
    });
    expect(Object.hasOwn(JSON.parse(lines[0]!), "error.type")).toBe(false);
    expect(lines[0]).not.toContain(url);
    expect(lines[0]).not.toContain("private-query");
    expect(lines[0]).not.toContain("private-body");
  });

  test.each([
    ["plain JSON", undefined],
    ["gzip-labelled JSON", { "content-encoding": "gzip", "content-length": "1024" }],
  ] as const)("unvalidated %s success stays unknown", async (_label, headers) => {
    const clock = manualClock();
    const result = await upstreamRequest(url, requestOptions(clock, async () => new Response('{"count":3}', { headers })));
    if (!result.ok) throw new Error("expected success");
    const isUnknown: 0 extends (1 & typeof result.value) ? false : unknown extends typeof result.value ? true : false = true;
    expect(isUnknown).toBe(true);
    expect(result.value).toEqual({ count: 3 });
  });

  test("returns a text response and respects explicit fetch init overrides", async () => {
    const clock = manualClock();
    let init: RequestInit | undefined;
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async (_input, options) => {
        init = options;
        return new Response("hello");
      }),
      responseType: "text",
      init: { cache: "reload", redirect: "follow" },
    });
    expect(result).toMatchObject({ ok: true, value: "hello" });
    expect(init).toMatchObject({ cache: "reload", redirect: "follow" });
  });

  test.each([
    ["valid", (value: unknown): string => { if (value !== "hello") throw new Error("invalid text"); return value.toUpperCase(); }, { ok: true, value: "HELLO" }],
    ["rejected", (_value: unknown): string => { throw new Error("invalid text"); }, { ok: false, kind: "invalid" }],
  ] as const)("text validator %s determines success", async (_label, parse, expected) => {
    const clock = manualClock();
    const result = await upstreamRequest(url, { ...requestOptions(clock, async () => new Response("hello")), responseType: "text", parse });
    expect(result).toMatchObject(expected);
  });

  test("an already-aborted parent skips fetch", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    parent.abort();
    let calls = 0;
    const result = await upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock }),
      maxBytes: 32,
      fetchImpl: async () => { calls++; return new Response("ok"); },
    });
    expect(result).toMatchObject({ ok: false, kind: "aborted", dispatched: false });
    expect(calls).toBe(0);
  });

  test("a parent abort interrupts fetch even when fetch ignores its signal", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    const result = await upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock }),
      maxBytes: 32,
      fetchImpl: async () => {
        queueMicrotask(() => parent.abort());
        return new Promise<Response>(() => undefined);
      },
    });
    expect(result).toMatchObject({ ok: false, kind: "aborted", dispatched: true });
  });

  test("an aborted request cancels a response body that arrives after fetch settles", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    let resolveFetch: (response: Response) => void = () => undefined;
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => { cancelled = resolve; });
    const resultPromise = upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock }),
      maxBytes: 32,
      fetchImpl: () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    });
    await Promise.resolve();
    parent.abort();
    expect(await resultPromise).toMatchObject({ ok: false, kind: "aborted", dispatched: true });
    resolveFetch(bodyResponse(new ReadableStream<Uint8Array>({ cancel: cancelled })));
    await cancellation;
    expect(parent.signal.aborted).toBe(true);
  });

  test("deadline expiry interrupts fetch even when fetch ignores its signal", async () => {
    const clock = manualClock();
    const result = await upstreamRequest(url, requestOptions(clock, async () => {
      queueMicrotask(() => { clock.advance(100); clock.expire(); });
      return new Promise<Response>(() => undefined);
    }));
    expect(result).toMatchObject({ ok: false, kind: "timeout", dispatched: true, durationMs: 100 });
  });

  test("logs one error-level timeout without inventing a response status", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async () => {
        queueMicrotask(() => { clock.advance(100); clock.expire(); });
        return new Promise<Response>(() => undefined);
      }),
      log: { route: "/api/funding/orders", provider: "coinbase" },
    });
    expect(result).toMatchObject({ ok: false, kind: "timeout", dispatched: true, durationMs: 100 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code: "UPSTREAM_TIMEOUT", outcome: "unavailable", level: "error",
      provider: "coinbase", "http.request.method": "GET", "error.type": "timeout", durationMs: 100,
    });
    expect(Object.hasOwn(JSON.parse(lines[0]!), "http.response.status_code")).toBe(false);
    expect(lines[0]).not.toContain("private");
  });

  test("deadline expiry interrupts a stalled body reader and cancels it", async () => {
    const clock = manualClock();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: () => { queueMicrotask(() => { clock.advance(100); clock.expire(); }); },
      cancel: () => { cancelled = true; },
    }, { highWaterMark: 0 });
    const result = await upstreamRequest(url, requestOptions(clock, async () => bodyResponse(stream)));
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
    expect(cancelled).toBe(true);
  });

  test("the first interrupt remains the cause when the other source fires later", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    const deadline = createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock });
    clock.expire();
    parent.abort();
    const result = await upstreamRequest(url, { deadline, maxBytes: 32, fetchImpl: async () => new Response("late") });
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
  });

  test("an already-expired deadline skips fetch", async () => {
    const clock = manualClock();
    const deadline = createUpstreamDeadline({ timeoutMs: 100, clock });
    clock.advance(100);
    let calls = 0;
    const result = await upstreamRequest(url, {
      deadline, maxBytes: 32,
      fetchImpl: async () => { calls++; return new Response("ok"); },
    });
    expect(result).toMatchObject({ ok: false, kind: "timeout", dispatched: false });
    expect(calls).toBe(0);
  });

  test("Content-Length over the limit returns oversized without reading the body", async () => {
    const clock = manualClock();
    let cancelled = false;
    let read = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: () => { read = true; },
      cancel: () => { cancelled = true; },
    }, { highWaterMark: 0 });
    const result = await upstreamRequest(url, requestOptions(clock, async () => bodyResponse(stream, { "content-length": "33" })));
    expect(result).toMatchObject({ ok: false, kind: "oversized", limitBytes: 32 });
    expect(cancelled).toBe(true);
    expect(read).toBe(false);
  });

  test("streaming over the limit returns oversized and cancels the reader", async () => {
    const clock = manualClock();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => { controller.enqueue(new Uint8Array(33)); },
      cancel: () => { cancelled = true; },
    });
    const result = await upstreamRequest(url, requestOptions(clock, async () => bodyResponse(stream)));
    expect(result).toMatchObject({ ok: false, kind: "oversized", limitBytes: 32 });
    expect(cancelled).toBe(true);
  });

  test.each([
    ["malformed JSON", () => new Response("{"), undefined],
    ["validator rejection", () => new Response("{}"), () => { throw new Error("invalid"); }],
    ["malformed UTF-8", () => new Response(new Uint8Array([0xff])), undefined],
    ["null JSON body", () => new Response(null), undefined],
    ["truncated identity body", () => new Response('{"ok":true}', { headers: { "content-encoding": "identity", "content-length": "12" } }), undefined],
  ] as const)("returns invalid for %s", async (_label, response, parse) => {
    const clock = manualClock();
    const options = requestOptions(clock, async () => response());
    const result = parse ? await upstreamRequest(url, { ...options, parse }) : await upstreamRequest(url, options);
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
  });

  test.each([302, 404, 503])("returns HTTP %i and cancels its response body", async (status) => {
    const clock = manualClock();
    let cancelled = false;
    const result = await upstreamRequest(url, requestOptions(clock, async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }), { status },
    )));
    expect(result).toMatchObject({ ok: false, kind: "http", status });
    expect(cancelled).toBe(true);
  });

  test("an asynchronous validator result is invalid", async () => {
    const clock = manualClock();
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async () => new Response("{}")),
      parse: async () => { throw new Error("rejected"); },
    });
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("a parent abort after the budget is spent reports timeout", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    const deadline = createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock });
    clock.advance(101);
    parent.abort();
    let calls = 0;
    const result = await upstreamRequest(url, { deadline, maxBytes: 32, fetchImpl: async () => { calls++; return new Response("{}"); } });
    expect(result).toMatchObject({ ok: false, kind: "timeout", dispatched: false });
    expect(calls).toBe(0);
  });

  test("a budget spent before the queued fetch starts skips fetch", async () => {
    const clock = manualClock();
    let calls = 0;
    const pending = upstreamRequest(url, requestOptions(clock, async () => { calls++; return new Response("{}"); }));
    clock.advance(200);
    expect(await pending).toMatchObject({ ok: false, kind: "timeout", dispatched: false });
    expect(calls).toBe(0);
  });

  test("a 206 partial response is invalid and its body is cancelled", async () => {
    const clock = manualClock();
    let cancelled = false;
    const result = await upstreamRequest(url, requestOptions(clock, async () => new Response(
      new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }), { status: 206 },
    )));
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(cancelled).toBe(true);
  });

  test("fetch rejection is a transport failure", async () => {
    const clock = manualClock();
    const result = await upstreamRequest(url, requestOptions(clock, async () => { throw new Error("transport"); }));
    expect(result).toMatchObject({ ok: false, kind: "transport", dispatched: true });
  });

  test("sequential requests consume a shared deadline's remaining budget", async () => {
    const clock = manualClock();
    const parent = createUpstreamDeadline({ timeoutMs: 100, clock });
    const first = await upstreamRequest(url, {
      deadline: parent.child(), maxBytes: 32,
      fetchImpl: async () => { clock.advance(40); return new Response("one"); }, responseType: "text",
    });
    const second = parent.child();
    expect(first).toMatchObject({ ok: true, value: "one" });
    expect(second.remainingMs()).toBe(60);
    expect(clock.budgets()).toEqual([100, 100, 60]);
    clock.advance(60);
    let calls = 0;
    const last = await upstreamRequest(url, {
      deadline: parent.child(), maxBytes: 32,
      fetchImpl: async () => { calls++; return new Response("late"); }, responseType: "text",
    });
    expect(last).toMatchObject({ ok: false, kind: "timeout" });
    expect(calls).toBe(0);
  });

  test("a parent abort propagates through a child deadline", async () => {
    const clock = manualClock();
    const parent = new AbortController();
    const deadline = createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock });
    const child = deadline.child(20);
    parent.abort();
    expect(child.signal.aborted).toBe(true);
    const result = await upstreamRequest(url, { deadline: child, maxBytes: 32, fetchImpl: async () => new Response("late") });
    expect(result).toMatchObject({ ok: false, kind: "aborted" });
    expect(clock.budgets()).toEqual([100, 20]);
  });

  test.each([0, 30_001, 1.5, Number.NaN])("rejects invalid timeout budget %s", (timeoutMs) => {
    expect(() => createUpstreamDeadline({ timeoutMs })).toThrow(RangeError);
  });

  test("rejects invalid byte limits before calling fetch", async () => {
    const clock = manualClock();
    let calls = 0;
    await expect(upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, clock }),
      maxBytes: 0, fetchImpl: async () => { calls++; return new Response("ok"); },
    })).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
  });

  test.each([
    [302, "UPSTREAM_HTTP_3XX", "error"],
    [404, "UPSTREAM_HTTP_4XX", "error"],
    [503, "UPSTREAM_HTTP_5XX", "error"],
  ] as const)("logs HTTP %i with %s and no private request data", async (status, code, level) => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async () => new Response("private-body", { status })),
      log: { route: "/api/funding/orders", provider: "coinbase" },
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code, level, outcome: "unavailable", provider: "coinbase",
      "http.request.method": "GET", "http.response.status_code": status, "error.type": String(status),
    });
    expect(lines[0]).not.toContain("private-query");
    expect(lines[0]).not.toContain("private-body");
  });

  test("parent abort after dispatch logs an error-level unavailable event", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const parent = new AbortController();
    await upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, clock, signal: parent.signal }),
      maxBytes: 32,
      fetchImpl: async () => {
        queueMicrotask(() => parent.abort());
        return new Promise<Response>(() => undefined);
      },
      log: { route: "/api/funding/orders" },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code: "UPSTREAM_ABORTED", outcome: "unavailable", level: "error",
      "http.request.method": "GET", "error.type": "aborted",
    });
    expect(Object.hasOwn(JSON.parse(lines[0]!), "http.response.status_code")).toBe(false);
  });

  test("parent abort before dispatch logs one info-level event without URL or body", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const controller = new AbortController();
    controller.abort();
    await upstreamRequest(url, {
      deadline: createUpstreamDeadline({ timeoutMs: 100, clock, signal: controller.signal }),
      maxBytes: 32,
      log: { route: "/api/funding/orders" },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code: "UPSTREAM_ABORTED", outcome: "skipped", level: "info",
      "http.request.method": "GET", "error.type": "aborted",
    });
    expect(Object.hasOwn(JSON.parse(lines[0]!), "http.response.status_code")).toBe(false);
    expect(lines[0]).not.toContain("private");
  });

  test.each([
    ["invalid JSON", () => new Response("{"), "UPSTREAM_INVALID_RESPONSE", "invalid_response", "invalid"],
    ["oversized length", () => new Response("{}", { headers: { "content-length": "33" } }), "UPSTREAM_OVERSIZED", "oversized", "unavailable"],
  ] as const)("logs response status for %s", async (_label, response, code, errorType, outcome) => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    await upstreamRequest(url, { ...requestOptions(clock, async () => response()), log: { route: "/api/funding/orders" } });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code, outcome, level: "error",
      "http.response.status_code": 200, "error.type": errorType,
    });
  });

  test("logs response status when aborted after receiving the response", async () => {
    const lines: string[] = [];
    setObservabilityLogWriterForTests((line) => { lines.push(line); });
    const clock = manualClock();
    const parent = new AbortController();
    const result = await upstreamRequest(url, {
      ...requestOptions(clock, async () => new Response("{}")),
      deadline: createUpstreamDeadline({ timeoutMs: 100, signal: parent.signal, clock }),
      parse: (value) => { parent.abort(); return value; },
      log: { route: "/api/funding/orders" },
    });
    expect(result).toMatchObject({ ok: false, kind: "aborted", dispatched: true });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "upstream-call", code: "UPSTREAM_ABORTED", outcome: "unavailable", level: "error",
      "http.response.status_code": 200, "error.type": "aborted",
    });
  });
});
