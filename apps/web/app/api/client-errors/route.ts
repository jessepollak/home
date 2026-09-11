import { URL } from "node:url";
import {
  sanitizeIdentifier,
  sanitizeRoutePath,
  scrubString,
} from "@/features/observability/scrub";
import { writeObservabilityEvent } from "@/server/observability/log";
import type { ObservabilityEvent } from "@/server/observability/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const CLIENT_ERROR_MAX_BODY_BYTES = 2_048;
export const CLIENT_ERROR_WINDOW_MS = 60_000;
export const CLIENT_ERROR_MAX_REPORTS_PER_WINDOW = 30;

const allowedKeys = new Set(["name", "message", "route"]);
const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
};

type ParsedClientErrorReport = {
  name: string;
  message: string;
  route: string;
};

type Permit = () => boolean;

class FixedWindowLimiter {
  private windowStartedAt = 0;
  private count = 0;

  take(now = Date.now()): boolean {
    if (now - this.windowStartedAt >= CLIENT_ERROR_WINDOW_MS || now < this.windowStartedAt) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    if (this.count >= CLIENT_ERROR_MAX_REPORTS_PER_WINDOW) return false;
    this.count += 1;
    return true;
  }
}

const limiter = new FixedWindowLimiter();

function emptyResponse(status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { ...responseHeaders, ...extraHeaders },
  });
}

function cancelBody(request: Request): void {
  try {
    if (request.body && !request.body.locked) {
      void request.body.cancel().catch(() => undefined);
    }
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
    if (parsedOrigin.origin !== rawOrigin) return false;
    if (parsedOrigin.origin !== requestOrigin) return false;
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
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
      if (total > CLIENT_ERROR_MAX_BODY_BYTES) {
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

export function parseClientErrorReport(value: unknown): ParsedClientErrorReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
    return null;
  }
  if (
    typeof record.name !== "string" ||
    typeof record.message !== "string" ||
    typeof record.route !== "string" ||
    record.name.length === 0 ||
    record.name.length > 80 ||
    record.message.length === 0 ||
    record.message.length > 1_024 ||
    record.route.length === 0 ||
    record.route.length > 512 ||
    !record.route.startsWith("/") ||
    record.route.startsWith("//") ||
    record.route.includes("://")
  ) {
    return null;
  }

  const name = sanitizeIdentifier(record.name, "Error");
  const message = scrubString(record.message).trim().slice(0, 256);
  const route = sanitizeRoutePath(record.route);
  if (!message) return null;

  return { name, message, route };
}

export function createClientErrorHandler(dependencies?: {
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
    if (declaredLength !== null && declaredLength > CLIENT_ERROR_MAX_BODY_BYTES) {
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

    const report = parseClientErrorReport(value);
    if (!report) return emptyResponse(400);

    try {
      log({
        kind: "client-error",
        route: report.route,
        errorName: report.name,
        summary: report.message,
      });
    } catch {
      // Reporting cannot change the endpoint or application outcome.
    }

    return emptyResponse(204);
  };
}

export const POST = createClientErrorHandler();
