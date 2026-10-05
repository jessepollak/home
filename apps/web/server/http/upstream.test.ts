import { describe, expect, test } from "bun:test";
import { createUpstreamDeadline, upstreamRequest } from "./upstream";

const URL = "https://upstream.example/data";

function createClock() {
  let now = 0;
  const timers: { at: number; controller: AbortController }[] = [];
  return {
    now: () => now,
    timeout(ms: number) {
      const controller = new AbortController();
      timers.push({ at: now + ms, controller });
      return controller.signal;
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers) {
        if (timer.at <= now) timer.controller.abort();
      }
    },
  };
}

function setup(signal?: AbortSignal) {
  const clock = createClock();
  return { clock, deadline: createUpstreamDeadline({ timeoutMs: 100, signal, clock }) };
}

function trackedBody(chunks: string[]) {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, reads: () => reads, cancelled: () => cancelled };
}

describe("bounded upstream requests", () => {
  test("parses ok JSON and passes the deadline signal to fetch", async () => {
    const { deadline, clock } = setup();
    const headers = { "x-provider-id": "response-id" };
    const result = await upstreamRequest(URL, {
      deadline,
      maxBytes: 1024,
      init: { method: "POST" },
      fetchImpl: async (input, init) => {
        expect(input).toBe(URL);
        expect(init?.signal).toBe(deadline.signal);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        expect(init?.cache).toBe("no-store");
        clock.advance(5);
        return Response.json({ count: 3 }, { headers });
      },
      parse: (value) => {
        expect(value).toEqual({ count: 3 });
        return "parsed";
      },
    });
    expect(result).toMatchObject({ ok: true, status: 200, value: "parsed", durationMs: 5 });
    if (!result.ok) throw new Error("Expected success");
    expect(result.headers.get("x-provider-id")).toBe("response-id");
  });

  test("bounds response headers in UTF-8 bytes before reading a body only when requested", async () => {
    const headers = { "x-test": "é" };
    const makeRequest = (maxHeaderBytes?: number) => {
      const { deadline } = setup();
      const tracked = trackedBody(["{}"]);
      return {
        tracked,
        result: upstreamRequest(URL, {
          deadline, maxBytes: 1024, maxHeaderBytes,
          fetchImpl: async () => new Response(tracked.body, { headers }),
        }),
      };
    };
    const bounded = makeRequest(7);
    expect(await bounded.result).toMatchObject({ ok: false, kind: "invalid" });
    expect(bounded.tracked.reads()).toBe(0);
    expect(bounded.tracked.cancelled()).toBeTrue();
    for (const limit of [8, undefined]) {
      const allowed = makeRequest(limit);
      expect(await allowed.result).toMatchObject({ ok: true, value: {} });
      expect(allowed.tracked.reads()).toBeGreaterThan(0);
    }
  });

  test("maps a parser failure to invalid", async () => {
    const cause = new Error("invalid envelope");
    const { deadline } = setup();
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: async () => Response.json({}),
      parse: () => { throw cause; },
    });
    expect(result).toMatchObject({ ok: false, kind: "invalid", cause, durationMs: 0 });
  });

  test("cancels a non-ok body without reading when no error-body option is supplied", async () => {
    const { deadline } = setup();
    const tracked = trackedBody(["diagnostic"]);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: async () => new Response(tracked.body, { status: 429, headers: { "retry-after": "2" } }),
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 429, durationMs: 0 });
    expect(result).not.toHaveProperty("body");
    expect(tracked.reads()).toBe(0);
    expect(tracked.cancelled()).toBeTrue();
    if (result.ok || result.kind !== "http") throw new Error("Expected HTTP failure");
    expect(result.headers.get("retry-after")).toBe("2");
  });

  test("returns bounded error bytes and headers on non-ok responses", async () => {
    const { deadline } = setup();
    const tracked = trackedBody(["query ", "rejected"]);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024, errorBodyMaxBytes: 32,
      fetchImpl: async () => new Response(tracked.body, { status: 400, headers: { "x-request-id": "provider-id" } }),
      parse: () => { throw new Error("Error bodies must not be parsed"); },
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 400, durationMs: 0 });
    if (result.ok || result.kind !== "http") throw new Error("Expected HTTP failure");
    expect(result.body).toEqual(new TextEncoder().encode("query rejected"));
    expect(result.headers.get("x-request-id")).toBe("provider-id");
  });

  test("omits oversized error bodies while retaining the HTTP failure", async () => {
    const { deadline } = setup();
    const tracked = trackedBody(["1234", "5678", "9"]);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024, errorBodyMaxBytes: 4,
      fetchImpl: async () => new Response(tracked.body, { status: 400, headers: { "x-request-id": "provider-id" } }),
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 400 });
    expect(result).not.toHaveProperty("body");
    expect(tracked.cancelled()).toBeTrue();
    if (result.ok || result.kind !== "http") throw new Error("Expected HTTP failure");
    expect(result.headers.get("x-request-id")).toBe("provider-id");
  });

  test("omits declared-oversized error bodies before reading while retaining HTTP status", async () => {
    for (const encoding of [undefined, "identity"]) {
      const { deadline } = setup();
      const tracked = trackedBody(["{}"]);
      const result = await upstreamRequest(URL, {
        deadline, maxBytes: 1024, errorBodyMaxBytes: 4,
        fetchImpl: async () => new Response(tracked.body, {
          status: 400,
          headers: { "content-length": "5", ...(encoding ? { "content-encoding": encoding } : {}) },
        }),
      });
      expect(result).toMatchObject({ ok: false, kind: "http", status: 400 });
      expect(result).not.toHaveProperty("body");
      expect(tracked.reads()).toBe(0);
      expect(tracked.cancelled()).toBeTrue();
    }
  });

  test("bounds decoded error bytes independently of an encoded content-length", async () => {
    const { deadline } = setup();
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024, errorBodyMaxBytes: 4,
      fetchImpl: async () => new Response("{}", {
        status: 400, headers: { "content-length": "5", "content-encoding": "gzip" },
      }),
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 400, body: new TextEncoder().encode("{}") });
  });

  test("omits unreadable error bodies while retaining the HTTP failure", async () => {
    const { deadline } = setup();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error("read failed")); },
    }, { highWaterMark: 0 });
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024, errorBodyMaxBytes: 32,
      fetchImpl: async () => new Response(body, { status: 503 }),
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 503 });
    expect(result).not.toHaveProperty("body");
  });

  test("bounds error reads by the same deadline without losing the HTTP status", async () => {
    const { deadline, clock } = setup();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() { clock.advance(100); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024, errorBodyMaxBytes: 32,
      fetchImpl: async () => new Response(body, { status: 400 }),
    });
    expect(result).toMatchObject({ ok: false, kind: "http", status: 400, durationMs: 100 });
    expect(result).not.toHaveProperty("body");
    expect(cancelled).toBeTrue();
  });

  test("maps an oversized success body to oversized", async () => {
    const { deadline } = setup();
    const tracked = trackedBody(["1234", "5678"]);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 4,
      fetchImpl: async () => new Response(tracked.body),
    });
    expect(result).toEqual({ ok: false, kind: "oversized", limitBytes: 4, durationMs: 0 });
    expect(tracked.cancelled()).toBeTrue();
  });

  test("rejects a content-length mismatch as invalid", async () => {
    const { deadline } = setup();
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: async () => new Response("{}", { headers: { "content-length": "3" } }),
    });
    expect(result).toEqual({ ok: false, kind: "invalid", durationMs: 0 });
  });

  test("rejects a 206 response as invalid without reading the partial body", async () => {
    const { deadline } = setup();
    const tracked = trackedBody(["{}"]);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: async () => new Response(tracked.body, { status: 206 }),
    });
    expect(result).toEqual({ ok: false, kind: "invalid", durationMs: 0 });
    expect(tracked.reads()).toBe(0);
    expect(tracked.cancelled()).toBeTrue();
  });

  test("enforces the timeout even when fetch ignores the signal", async () => {
    const { deadline, clock } = setup();
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: () => {
        clock.advance(100);
        return new Promise<Response>(() => {});
      },
    });
    expect(result).toEqual({ ok: false, kind: "timeout", dispatched: true, durationMs: 100 });
    expect(deadline.signal.aborted).toBeTrue();
  });

  test("does not dispatch for an already-aborted parent signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deadline } = setup(controller.signal);
    let dispatched = false;
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: async () => { dispatched = true; return Response.json({}); },
    });
    expect(result).toEqual({ ok: false, kind: "aborted", dispatched: false, durationMs: 0 });
    expect(dispatched).toBeFalse();
  });

  test("maps parent cancellation after dispatch to aborted", async () => {
    const controller = new AbortController();
    const { deadline } = setup(controller.signal);
    const result = await upstreamRequest(URL, {
      deadline, maxBytes: 1024,
      fetchImpl: () => {
        controller.abort();
        return new Promise<Response>(() => {});
      },
    });
    expect(result).toEqual({ ok: false, kind: "aborted", dispatched: true, durationMs: 0 });
  });
});
