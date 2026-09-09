import { sanitizePathname, scrubString } from "@/features/observability/scrub";
import {
  writeStructuredLog,
  type ObservabilityEvent,
} from "@/server/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const allowedKeys = new Set(["name", "message", "route"]);

export function parseClientErrorReport(
  value: unknown,
): { name: string; message: string; route: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return null;
    }
  }
  if (
    typeof record.name !== "string" ||
    typeof record.message !== "string" ||
    typeof record.route !== "string"
  ) {
    return null;
  }
  const route = sanitizePathname(record.route);
  if (!route.startsWith("/")) {
    return null;
  }
  const name = scrubString(record.name).trim().slice(0, 128);
  const message = scrubString(record.message).trim().slice(0, 256);
  if (!name || !message) {
    return null;
  }
  return { name, message, route };
}

export function createClientErrorHandler(dependencies?: {
  log?: (event: ObservabilityEvent) => void;
}) {
  const log = dependencies?.log ?? writeStructuredLog;

  return async function POST(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    let raw: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return new Response(null, { status: 413 });
      }
      raw = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }

    const parsed = parseClientErrorReport(raw);
    if (!parsed) {
      return new Response(null, { status: 400 });
    }

    log({
      kind: "client-error",
      route: parsed.route,
      errorCode: "CLIENT_EXCEPTION",
      name: parsed.name,
      message: parsed.message,
    });
    return new Response(null, { status: 204 });
  };
}

export const POST = createClientErrorHandler();
