import "server-only";

import { parseCdpCorrelationId } from "@/shared/observability/cdp-correlation";
import { isRecord } from "@/shared/guards";
import type { SqlRejectionReason } from "./errors";

export async function readSqlRejection(response: Response, parentSignal: AbortSignal): Promise<{ sqlRejectionReason: SqlRejectionReason; cdpCorrelationId?: string }> {
  if (!response.body) return { sqlRejectionReason: "unknown" };
  const reader = response.body.getReader();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const interrupted = Symbol("interrupted");
  let onAbort = () => {};
  const abort = new Promise<typeof interrupted>((resolve) => {
    onAbort = () => resolve(interrupted);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abort]);
      if (next === interrupted) return { sqlRejectionReason: "unknown" };
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8_192) return { sqlRejectionReason: "unknown" };
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(payload)) return { sqlRejectionReason: "unknown" };
    const correlationId = parseCdpCorrelationId(payload.correlationId);
    const diagnostic = correlationId ? { cdpCorrelationId: correlationId } : {};
    const message = typeof payload.errorMessage === "string" ? payload.errorMessage : "";
    if (/\b(MAX_BYTES_TO_READ|MEMORY_LIMIT_EXCEEDED|TOO_MANY_ROWS|TOO_MANY_BYTES|QUERY_TOO_BIG)\b/i.test(message)) return { ...diagnostic, sqlRejectionReason: "resource-limit" };
    if (/\b(SYNTAX_ERROR|UNKNOWN_IDENTIFIER|UNKNOWN_FUNCTION|TYPE_MISMATCH|ILLEGAL_TYPE_OF_ARGUMENT)\b/i.test(message)) return { ...diagnostic, sqlRejectionReason: "invalid-query" };
    return { ...diagnostic, sqlRejectionReason: payload.errorType === "invalid_request" ? "invalid-request" : "unknown" };
  } catch {
    return { sqlRejectionReason: "unknown" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    try { await Promise.race([reader.cancel(), Promise.resolve()]); } catch { return { sqlRejectionReason: "unknown" }; }
    reader.releaseLock();
  }
}
