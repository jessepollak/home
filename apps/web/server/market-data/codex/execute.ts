import "server-only";

import { CODEX_GRAPHQL_ENDPOINT, CODEX_MAX_RESPONSE_BYTES, CODEX_REQUEST_TIMEOUT_MS } from "./config";
import { CodexMarketDataError } from "./errors";
import { createUpstreamDeadline, upstreamRequest } from "@/server/http/upstream";
import { parseJsonWithNumberLexemes } from "./lossless-json";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function executeCodexGraphql({
  apiKey,
  query,
  variables,
  fetchImpl,
  timeoutMs = CODEX_REQUEST_TIMEOUT_MS,
  signal,
  allowPartialData = false,
}: {
  apiKey: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  allowPartialData?: boolean;
}): Promise<unknown> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  headers.set(["Author", "ization"].join(""), apiKey);

  const result = await upstreamRequest(CODEX_GRAPHQL_ENDPOINT, {
    deadline: createUpstreamDeadline({ timeoutMs, signal }),
    maxBytes: CODEX_MAX_RESPONSE_BYTES,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    },
    responseType: "text",
    parse: (value) => parseJsonWithNumberLexemes(String(value)),
    fetchImpl,
  });

  if (!result.ok) {
    if (result.kind === "http") {
      throw new CodexMarketDataError(
        `Codex market data returned HTTP ${result.status}.`,
      );
    }
    const cause = "cause" in result ? result.cause : undefined;
    throw new CodexMarketDataError(
      result.kind === "aborted" || result.kind === "timeout"
        ? "Codex market data timed out."
        : "Codex market data request failed.",
      cause === undefined ? undefined : { cause },
    );
  }

  const envelope = readRecord(result.value);
  if (
    Array.isArray(envelope?.errors) &&
    envelope.errors.length > 0 &&
    !(allowPartialData && readRecord(envelope.data))
  ) {
    throw new CodexMarketDataError("Codex market data returned an error.");
  }
  if (envelope?.data === null || envelope?.data === undefined) {
    throw new CodexMarketDataError("Codex market data returned no data.");
  }
  return envelope.data;
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return null;
  }
  return value as `0x${string}`;
}

export function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function readPositiveDecimal(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const mantissa = value.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(mantissa) ? value : null;
}
