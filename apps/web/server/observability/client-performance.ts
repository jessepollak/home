import "server-only";

import { URL } from "node:url";
import { CLIENT_PERFORMANCE_KINDS, clientPerformanceBucket, parseClientPerformanceReport,
  type ClientPerformanceKind } from "@/shared/observability/client-performance.contract";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";

export const CLIENT_PERFORMANCE_MAX_BODY_BYTES = 2_048;
export const CLIENT_PERFORMANCE_WINDOW_MS = 60_000;
export const CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW = 60;
export const CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW = 20;

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
};

type Permit = (bucket: "interaction" | "reporting") => boolean;

class FixedWindowLimiter {
  private windowStartedAt = 0;
  private count = 0;
  constructor(private readonly max: number) {}

  take(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= CLIENT_PERFORMANCE_WINDOW_MS || now < this.windowStartedAt) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    if (this.count >= this.max) return false;
    this.count += 1;
    return true;
  }
}

export function createClientPerformancePermits(now: () => number = Date.now): Permit {
  const reporting = new FixedWindowLimiter(CLIENT_PERFORMANCE_MAX_REPORTS_PER_WINDOW);
  const interaction = new FixedWindowLimiter(CLIENT_PERFORMANCE_MAX_INTERACTION_REPORTS_PER_WINDOW);
  return (bucket) => (bucket === "interaction" ? interaction : reporting).take(now());
}

const defaultTakePermit = createClientPerformancePermits();

export function createClientPerformanceHandler(dependencies?: {
  log?: (event: ObservabilityEvent) => unknown;
  takePermit?: Permit;
  deployment?: string;
}) {
  const log = dependencies?.log ?? writeObservabilityEvent;
  const takePermit = dependencies?.takePermit ?? defaultTakePermit;

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
    const kinds = new URL(request.url).searchParams.getAll("kind");
    if (kinds.length !== 1 || !CLIENT_PERFORMANCE_KINDS.some((kind) => kind === kinds[0])) {
      cancelBody(request);
      return emptyResponse(400);
    }
    const kind = kinds[0] as ClientPerformanceKind;
    if (!takePermit(clientPerformanceBucket(kind))) {
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
    if (!report || report.kind !== kind) return emptyResponse(400);

    try {
      const deploymentId = dependencies?.deployment ?? process.env.VERCEL_DEPLOYMENT_ID;
      log(report.kind === "home-navigation" || report.kind === "home-scroll"
        ? { ...report, deployment: typeof deploymentId === "string" && deploymentId.length > 0
            ? deploymentId : "local" }
        : report);
    } catch {
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
