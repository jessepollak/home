import "server-only";

import { readBoundedRequestBytes } from "@/server/http/request";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const WEBHOOK_READ_TIMEOUT_MS = 6_000;

export async function readBoundedWebhookBody(
  request: Request,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Uint8Array | null> {
  const maxBytes = options.maxBytes ?? MAX_WEBHOOK_BYTES;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_READ_TIMEOUT_MS;
  if (!request.body || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return null;
  const result = await readBoundedRequestBytes(request, { maxBytes, timeoutMs, ignoreContentLength: true });
  if (result.kind === "empty") return new Uint8Array();
  return result.kind === "ok" ? result.bytes : null;
}
