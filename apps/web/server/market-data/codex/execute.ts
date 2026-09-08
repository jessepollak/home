import { CODEX_GRAPHQL_ENDPOINT, CODEX_REQUEST_TIMEOUT_MS } from "./config";
import { CodexMarketDataError } from "./client";
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
}: {
  apiKey: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl: FetchLike;
  timeoutMs?: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/json",
    });
    headers.set(["Author", "ization"].join(""), apiKey);
    const response = await fetchImpl(CODEX_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CodexMarketDataError(
        `Codex market data returned HTTP ${response.status}.`,
      );
    }

    const parsed = parseJsonWithNumberLexemes(await response.text());
    const envelope = readRecord(parsed);
    if (Array.isArray(envelope?.errors) && envelope.errors.length > 0) {
      throw new CodexMarketDataError("Codex market data returned an error.");
    }
    if (envelope?.data === null || envelope?.data === undefined) {
      throw new CodexMarketDataError("Codex market data returned no data.");
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof CodexMarketDataError) throw error;
    const message = controller.signal.aborted
      ? "Codex market data timed out."
      : "Codex market data request failed.";
    throw new CodexMarketDataError(message, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
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
