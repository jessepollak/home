import "server-only";

import { URL } from "node:url";
import { parseClientPerformanceReport } from "@/shared/observability/client-performance.contract";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";

export const CLIENT_PERFORMANCE_MAX_BODY_BYTES = 2_048;
export const CLIENT_PERFORMANCE_WINDOW_MS = 60_000;
export const CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW = 30;

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
};

type Permit = () => boolean;

class FixedWindowLimiter {
  private windowStartedAt = 0;
  private count = 0;

  take(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= CLIENT_PERFORMANCE_WINDOW_MS || now < this.windowStartedAt) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    if (this.count >= CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW) return false;
    this.count += 1;
    return true;
  }
}

const limiter = new FixedWindowLimiter();

export function createClientPerformanceHandler(dependencies?: {
  log?: (event: ObservabilityEvent) => unknown;
  takePermit?: Permit;
}) {
  const log = dependencies?.log ?? writeObservabilityEvent;
  const takePermit = dependencies?.takePermit ?? (() => limiter.take());

  return async function POST(request: Request): Promise<Response> {
    if (!hasSameOrigin(request)) {
      cancelBody(request);
      return emptyResponse(403);
    }
    if (!hasJsonContentType(request) || request.headers.has("content-encoding")) {
      cancelBody(request);
      return emptyResponse(415);
    }

    const declaredLength = declaredBodyLength(request);
    if (Number.isNaN(declaredLength) || (declaredLength !== null && declaredLength < 1)) {
      cancelBody(request);
      return emptyResponse(400);
    }
    if (declaredLength !== null && declaredLength > CLIENT_PERFORMANCE_MAX_BODY_BYTES) {
      cancelBody(request);
      return emptyResponse(413);
    }
    if (!takePermit()) {
      cancelBody(request);
      return emptyResponse(429, { "retry-after": "60" });
    }

    const body = await readBoundedBody(request);
    if (body.kind === "too-large") return emptyResponse(413);
    if (body.kind === "invalid") return emptyResponse(400);

    let value: unknown;
    try {
      value = JSON.parse(body.text);
    } catch {
      return emptyResponse(400);
    }
    const report = parseClientPerformanceReport(value);
    if (!report) return emptyResponse(400);

    try {
      log(report);
    } catch {
      // Reporting cannot change the endpoint or application outcome.
    }
    return emptyResponse(204);
  };
}

function emptyResponse(status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(null, { status, headers: { ...responseHeaders, ...extraHeaders } });
}

function cancelBody(request: Request): void {
  try {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => undefined);
  } catch {
    // Reject paths do not depend on transport cleanup succeeding.
  }
}

function hasSameOrigin(request: Request): boolean {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || rawOrigin === "null") return false;
  try {
    const requestOrigin = new URL(request.url).origin;
    const parsedOrigin = new URL(rawOrigin);
    if (parsedOrigin.origin !== rawOrigin || parsedOrigin.origin !== requestOrigin) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return Boolean(contentType && contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json");
}

function declaredBodyLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}

async function readBoundedBody(
  request: Request,
): Promise<{ kind: "ok"; text: string } | { kind: "too-large" } | { kind: "invalid" }> {
  if (!request.body) return { kind: "ok", text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > CLIENT_PERFORMANCE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too-large" };
      }
      chunks.push(result.value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { kind: "invalid" };
  }
}
