import "server-only";

import { emitUpstreamCall } from "@/server/observability/log";
import type { UpstreamCallCode } from "@/server/observability/schema";

type DeadlineClock = { now(): number; timeout(ms: number): AbortSignal };
type FailureKind = "aborted" | "timeout" | "transport" | "http" | "oversized" | "invalid";

const defaultClock: DeadlineClock = {
  now: () => performance.now(),
  timeout: (ms) => AbortSignal.timeout(ms),
};
const interrupted = Symbol("upstream interrupted");

function positiveBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
    throw new RangeError("Upstream timeout must be a positive safe integer of at most 30000ms.");
  }
  return value;
}

class Deadline {
  readonly signal: AbortSignal;
  private readonly timeoutSignal: AbortSignal;
  private readonly expiresAt: number;
  private interruption?: "aborted" | "timeout";

  constructor(
    budgetMs: number,
    private readonly clock: DeadlineClock,
    private readonly parentSignal?: AbortSignal,
    private readonly parent?: Deadline,
  ) {
    this.expiresAt = clock.now() + budgetMs;
    this.timeoutSignal = budgetMs <= 0
      ? AbortSignal.abort()
      : clock.timeout(Math.ceil(budgetMs));
    this.signal = AbortSignal.any(
      parentSignal ? [parentSignal, this.timeoutSignal] : [this.timeoutSignal],
    );
    const recordInterruption = () => {
      this.interruption ??= parentSignal?.aborted && this.remainingMs() > 0
        ? parent?.interruptionKind() ?? "aborted"
        : "timeout";
    };
    if (this.signal.aborted) recordInterruption();
    else this.signal.addEventListener("abort", recordInterruption, { once: true });
  }

  remainingMs(): number {
    return Math.max(0, this.expiresAt - this.clock.now());
  }

  child(maxMs?: number): Deadline {
    if (maxMs !== undefined) positiveBudget(maxMs);
    const remaining = this.remainingMs();
    return new Deadline(
      Math.min(maxMs ?? remaining, remaining),
      this.clock,
      this.signal,
      this,
    );
  }

  interruptionKind(): "aborted" | "timeout" | undefined {
    if (this.interruption) return this.interruption;
    if (this.remainingMs() <= 0) {
      this.interruption = "timeout";
    } else if (this.parent) {
      this.interruption = this.parent.interruptionKind();
    } else if (this.parentSignal?.aborted) {
      this.interruption = "aborted";
    }
    if (!this.interruption && (this.timeoutSignal.aborted || this.remainingMs() <= 0)) {
      this.interruption = "timeout";
    }
    return this.interruption;
  }

  now(): number {
    return this.clock.now();
  }
}

export type UpstreamDeadline = Deadline;

export function createUpstreamDeadline(options: {
  timeoutMs: number;
  signal?: AbortSignal;
  clock?: DeadlineClock;
}): UpstreamDeadline {
  return new Deadline(positiveBudget(options.timeoutMs), options.clock ?? defaultClock, options.signal);
}

export type UpstreamResult<T> =
  | { ok: true; status: number; headers: Headers; value: T; durationMs: number }
  | { ok: false; kind: "aborted" | "timeout" | "transport"; dispatched: boolean; cause?: unknown; durationMs: number }
  | { ok: false; kind: "invalid"; cause?: unknown; durationMs: number }
  | { ok: false; kind: "http"; status: number; headers: Headers; body?: Uint8Array; durationMs: number }
  | { ok: false; kind: "oversized"; limitBytes: number; durationMs: number };

export type UpstreamRequestOptions<T = unknown> = {
  init?: Omit<RequestInit, "signal">;
  deadline: UpstreamDeadline;
  maxBytes: number;
  maxHeaderBytes?: number;
  errorBodyMaxBytes?: number;
  parse?: (value: unknown) => T;
  responseType?: "json" | "text";
  fetchImpl?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
  log?: { route: string; provider?: string };
};

async function raceSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw interrupted;
  let onAbort: () => void = () => undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(interrupted);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, abort]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => undefined);
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | "oversized"> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const next = await raceSignal(reader.read(), signal);
      if (next.done) {
        complete = true;
        break;
      }
      size += next.value.byteLength;
      if (size > maxBytes) return "oversized";
      chunks.push(next.value.slice());
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const failureCodes: Record<FailureKind, UpstreamCallCode> = {
  aborted: "UPSTREAM_ABORTED",
  timeout: "UPSTREAM_TIMEOUT",
  transport: "UPSTREAM_TRANSPORT",
  http: "UPSTREAM_HTTP_4XX",
  oversized: "UPSTREAM_OVERSIZED",
  invalid: "UPSTREAM_INVALID_RESPONSE",
};

export function upstreamRequest<T>(
  input: string | URL,
  options: UpstreamRequestOptions<T> & { parse: (value: unknown) => T },
): Promise<UpstreamResult<T>>;
export function upstreamRequest(
  input: string | URL,
  options: UpstreamRequestOptions<unknown> & { parse?: undefined },
): Promise<UpstreamResult<unknown>>;
export async function upstreamRequest(
  input: string | URL,
  options: UpstreamRequestOptions<unknown>,
): Promise<UpstreamResult<unknown>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new RangeError("Upstream maxBytes must be a positive safe integer.");
  }
  if (options.maxHeaderBytes !== undefined && (!Number.isSafeInteger(options.maxHeaderBytes) || options.maxHeaderBytes < 1)) {
    throw new RangeError("Upstream maxHeaderBytes must be a positive safe integer.");
  }
  if (options.errorBodyMaxBytes !== undefined && (!Number.isSafeInteger(options.errorBodyMaxBytes) || options.errorBodyMaxBytes < 1)) {
    throw new RangeError("Upstream errorBodyMaxBytes must be a positive safe integer.");
  }
  const { deadline, maxBytes, log } = options;
  const start = deadline.now();
  let dispatched = false;
  let responseStatus: number | undefined;
  const method = options.init?.method?.toUpperCase() ?? "GET";
  const fail = (kind: FailureKind, details: { status?: number; headers?: Headers; body?: Uint8Array; cause?: unknown } = {}): UpstreamResult<unknown> => {
    const durationMs = Math.max(0, deadline.now() - start);
    if (log) {
      const status = details.status ?? responseStatus;
      emitUpstreamCall({
        route: log.route,
        provider: log.provider,
        code: kind === "http" && status !== undefined
          ? status < 400 ? "UPSTREAM_HTTP_3XX" : status < 500 ? "UPSTREAM_HTTP_4XX" : "UPSTREAM_HTTP_5XX"
          : failureCodes[kind],
        outcome: kind === "aborted" && !dispatched ? "skipped" : kind === "invalid" ? "invalid" : "unavailable",
        method,
        statusCode: status,
        errorType: kind === "http" && status !== undefined ? String(status) : kind === "invalid" ? "invalid_response" : kind,
        durationMs,
      });
    }
    if (kind === "http") {
      if (details.status === undefined || details.headers === undefined) throw new Error("Upstream http failure requires status and headers.");
      return { ok: false, kind, status: details.status, headers: details.headers, ...(details.body === undefined ? {} : { body: details.body }), durationMs };
    }
    if (kind === "oversized") return { ok: false, kind, limitBytes: maxBytes, durationMs };
    if (kind === "invalid") return { ok: false, kind, ...(details.cause === undefined ? {} : { cause: details.cause }), durationMs };
    return { ok: false, kind, dispatched, ...(details.cause === undefined ? {} : { cause: details.cause }), durationMs };
  };
  const preflight = deadline.interruptionKind();
  if (preflight) return fail(preflight);

  let response: Response;
  try {
    const pendingFetch = Promise.resolve().then(() => {
      if (deadline.interruptionKind()) throw interrupted;
      const fetchImpl = options.fetchImpl ?? fetch;
      dispatched = true;
      return fetchImpl(input, {
        redirect: "manual",
        cache: "no-store",
        ...options.init,
        signal: deadline.signal,
      });
    });
    void pendingFetch.then(
      (lateResponse) => { if (deadline.signal.aborted) cancelBody(lateResponse.body); },
      () => undefined,
    );
    response = await raceSignal(pendingFetch, deadline.signal);
    responseStatus = response.status;
  } catch (error) {
    const kind = deadline.interruptionKind();
    return fail(kind ?? "transport", { cause: error === interrupted ? undefined : error });
  }

  try {
    const afterFetch = deadline.interruptionKind();
    if (afterFetch) {
      cancelBody(response.body);
      return fail(afterFetch);
    }
    if (response.status === 206) {
      cancelBody(response.body);
      return fail("invalid");
    }
    const declaredLengthHeader = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    const declaredLength = (!encoding || encoding.trim().toLowerCase() === "identity") &&
      declaredLengthHeader !== null && /^\d+$/.test(declaredLengthHeader)
      ? Number(declaredLengthHeader) : undefined;
    if (!response.ok) {
      let body: Uint8Array | undefined;
      if (
        options.errorBodyMaxBytes === undefined ||
        (declaredLength !== undefined && declaredLength > options.errorBodyMaxBytes)
      ) {
        cancelBody(response.body);
      } else {
        try {
          const bytes = await boundedBytes(response.body, options.errorBodyMaxBytes, deadline.signal);
          if (bytes !== "oversized" && !deadline.interruptionKind()) body = bytes;
        } catch {
          return fail("http", { status: response.status, headers: response.headers });
        }
      }
      return fail("http", { status: response.status, headers: response.headers, body });
    }
    if (options.maxHeaderBytes !== undefined) {
      const encoder = new TextEncoder();
      let headerBytes = 0;
      response.headers.forEach((value, name) => {
        headerBytes += encoder.encode(name).byteLength + encoder.encode(value).byteLength;
      });
      if (headerBytes > options.maxHeaderBytes) {
        cancelBody(response.body);
        return fail("invalid");
      }
    }
    const validLength = declaredLength !== undefined && Number.isSafeInteger(declaredLength) ? declaredLength : undefined;
    if (declaredLength !== undefined && declaredLength > maxBytes) {
      cancelBody(response.body);
      return fail("oversized");
    }

    let bytes: Uint8Array | "oversized";
    try {
      bytes = await boundedBytes(response.body, maxBytes, deadline.signal);
    } catch (error) {
      const kind = deadline.interruptionKind();
      return fail(kind ?? "transport", { cause: error === interrupted ? undefined : error });
    }
    const afterRead = deadline.interruptionKind();
    if (afterRead) return fail(afterRead);
    if (bytes === "oversized") return fail("oversized");
    if (validLength !== undefined && bytes.byteLength !== validLength) return fail("invalid");

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const raw: unknown = options.responseType === "text" ? text : JSON.parse(text);
      const value = options.parse ? options.parse(raw) : raw;
      if (options.parse && typeof (value as { then?: unknown } | null)?.then === "function") {
        void Promise.resolve(value).catch(() => undefined);
        return fail("invalid");
      }
      const afterParse = deadline.interruptionKind();
      if (afterParse) return fail(afterParse);
      const durationMs = Math.max(0, deadline.now() - start);
      if (log) {
        emitUpstreamCall({
          route: log.route, provider: log.provider, code: "UPSTREAM_OK", outcome: "ok",
          method, statusCode: response.status, durationMs,
        });
      }
      return { ok: true, status: response.status, headers: response.headers, value, durationMs };
    } catch (error) {
      const kind = deadline.interruptionKind();
      return fail(kind ?? "invalid", { cause: error });
    }
  } catch (error) {
    return fail(deadline.interruptionKind() ?? "transport", { cause: error });
  }
}
