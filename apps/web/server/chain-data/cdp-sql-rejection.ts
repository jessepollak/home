import "server-only";

import { parseCdpCorrelationId } from "@/shared/observability/cdp-correlation";
import { isRecord } from "@/shared/guards";
import type { SqlRejectionReason } from "./errors";

export function readSqlRejection(bytes?: Uint8Array): { sqlRejectionReason: SqlRejectionReason; cdpCorrelationId?: string } {
  if (!bytes || bytes.byteLength > 8_192) return { sqlRejectionReason: "unknown" };
  try {
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
  }
}
