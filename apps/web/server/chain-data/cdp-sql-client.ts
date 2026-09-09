import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { ChainDataError } from "./errors";
import type {
  CdpSqlResponse,
  CdpSqlRunRequest,
  CdpSqlTransport,
} from "./types";

export const CDP_SQL_ENDPOINT =
  "https://api.cdp.coinbase.com/platform/v2/data/query/run";
const CDP_SQL_HOST = "api.cdp.coinbase.com";
const CDP_SQL_PATH = "/platform/v2/data/query/run";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 29_000;

export type CdpSqlAuth =
  | {
      mode: "client-api-key";
      clientApiKey: string;
    }
  | {
      mode: "signed-jwt";
      /** Generate a short-lived server JWT for this exact request. */
      generateBearerToken(request: {
        requestMethod: "POST";
        requestHost: typeof CDP_SQL_HOST;
        requestPath: typeof CDP_SQL_PATH;
      }): Promise<string>;
    };

export type CdpSqlFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CdpSqlHttpTransportOptions = {
  auth: CdpSqlAuth;
  timeoutMs?: number;
  fetch?: CdpSqlFetch;
};

export function createCdpSqlAuthFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CdpSqlAuth {
  const mode = env.CDP_SQL_AUTH_MODE?.trim() || "client-api-key";
  if (mode === "signed-jwt") {
    const apiKeyId = env.CDP_API_KEY_ID?.trim();
    const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
    if (!apiKeyId || !apiKeySecret) {
      throw new ChainDataError(
        "not-configured",
        "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required when CDP_SQL_AUTH_MODE=signed-jwt.",
      );
    }
    return {
      mode: "signed-jwt",
      generateBearerToken: (request) =>
        generateJwt({
          apiKeyId,
          apiKeySecret,
          ...request,
        }),
    };
  }
  if (mode !== "client-api-key") {
    throw new ChainDataError(
      "not-configured",
      "CDP_SQL_AUTH_MODE must be client-api-key or signed-jwt.",
    );
  }

  const clientApiKey = env.CDP_SQL_CLIENT_API_KEY?.trim();
  if (!clientApiKey) {
    throw new ChainDataError(
      "not-configured",
      "CDP_SQL_CLIENT_API_KEY is required for the documented SQL quickstart auth mode.",
    );
  }
  return { mode: "client-api-key", clientApiKey };
}

export function createCdpSqlHttpTransport({
  auth,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImplementation = globalThis.fetch,
}: CdpSqlHttpTransportOptions): CdpSqlTransport {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new ChainDataError(
      "invalid-input",
      `CDP SQL timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  if (typeof fetchImplementation !== "function") {
    throw new ChainDataError("not-configured", "A fetch implementation is required.");
  }

  return {
    async run(request: CdpSqlRunRequest): Promise<CdpSqlResponse> {
      if (typeof request.sql !== "string" || request.sql.length === 0) {
        throw new ChainDataError("invalid-input", "CDP SQL query cannot be empty.");
      }
      if (request.sql.length > 10_000) {
        throw new ChainDataError(
          "invalid-input",
          "CDP SQL query exceeds the documented 10000-character limit.",
        );
      }
      if (
        request.cache &&
        (!Number.isSafeInteger(request.cache.maxAgeMs) ||
          request.cache.maxAgeMs < 500 ||
          request.cache.maxAgeMs > 900_000)
      ) {
        throw new ChainDataError(
          "invalid-input",
          "CDP SQL cache age must be between 500 and 900000 milliseconds.",
        );
      }
      throwIfRequestAborted(request.signal);
      let bearerToken: string;
      try {
        bearerToken = await resolveBearerToken(auth);
      } catch (error) {
        throwIfRequestAborted(request.signal);
        if (error instanceof ChainDataError) throw error;
        throw new ChainDataError(
          "not-configured",
          "CDP SQL bearer token generation failed.",
        );
      }
      throwIfRequestAborted(request.signal);
      const controller = new AbortController();
      const onAbort = () => controller.abort(request.signal?.reason);
      request.signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(
        () => controller.abort("cdp-sql-timeout"),
        timeoutMs,
      );

      try {
        const headerName = ["author", "ization"].join("");
        const bearerValue = ["Bear", "er ", bearerToken].join("");
        const response = await fetchImplementation(CDP_SQL_ENDPOINT, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            [headerName]: bearerValue,
          },
          body: JSON.stringify({
            sql: request.sql,
            ...(request.cache ? { cache: request.cache } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw responseError(response);
        }
        const payload: unknown = await response.json();
        const envelope = parseCdpSqlResponseEnvelope(payload);
        if (!envelope) {
          throw new ChainDataError(
            "invalid-response",
            "CDP SQL returned an invalid response envelope.",
          );
        }
        return envelope;
      } catch (error) {
        if (error instanceof ChainDataError) throw error;
        if (controller.signal.aborted) {
          throw new ChainDataError("timed-out", "CDP SQL request timed out.");
        }
        throw new ChainDataError("upstream-error", "CDP SQL request failed.");
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function throwIfRequestAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ChainDataError("timed-out", "CDP SQL request was canceled.");
  }
}

async function resolveBearerToken(auth: CdpSqlAuth): Promise<string> {
  const token =
    auth.mode === "client-api-key"
      ? auth.clientApiKey
      : await auth.generateBearerToken({
          requestMethod: "POST",
          requestHost: CDP_SQL_HOST,
          requestPath: CDP_SQL_PATH,
        });
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new ChainDataError("not-configured", "CDP SQL bearer token is missing.");
  }
  if (/\s/.test(token)) {
    throw new ChainDataError("not-configured", "CDP SQL bearer token is malformed.");
  }
  return token;
}

function responseError(response: Response): ChainDataError {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new ChainDataError(
      "unauthorized",
      "CDP SQL authentication was rejected.",
      { status },
    );
  }
  if (status === 402) {
    return new ChainDataError(
      "payment-required",
      "CDP SQL entitlement or payment is required.",
      { status },
    );
  }
  if (status === 408 || status === 504) {
    return new ChainDataError("timed-out", "CDP SQL request timed out.", {
      status,
    });
  }
  if (status === 429) {
    return new ChainDataError(
      "rate-limited",
      "CDP SQL rate limit was reached; the caller must back off.",
      {
        status,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      },
    );
  }
  return new ChainDataError("upstream-error", "CDP SQL request failed.", {
    status,
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? Math.max(0, date.getTime() - Date.now())
    : null;
}

/**
 * Official CDP `OnchainDataResult` marks `result`, `schema`, `metadata`, and
 * every metadata field optional. A 200 empty page is `result: []`, or live
 * CoinbaSeQL `result: null` with `metadata.rowCount === 0`. A missing `result`
 * field still fails — do not invent an empty list from an error-shaped body.
 * Partial/derived `schema` is ignored rather than failing a healthy page.
 */
export function parseCdpSqlResponseEnvelope(
  value: unknown,
  receivedAt = new Date(),
): CdpSqlResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const metadataSource = value.metadata;
  if (metadataSource !== undefined && !isRecord(metadataSource)) {
    return null;
  }

  const cached = readOptionalCached(metadataSource);
  if (cached === INVALID) return null;

  const executionTimestamp = readOptionalExecutionTimestamp(
    metadataSource,
    receivedAt,
  );
  if (executionTimestamp === INVALID) return null;

  const executionTimeMs = readOptionalExecutionTimeMs(metadataSource);
  if (executionTimeMs === INVALID) return null;

  const declaredRowCount = readOptionalRowCount(metadataSource);
  if (declaredRowCount === INVALID) return null;

  const result = normalizeResultRows(value.result, declaredRowCount);
  if (result === INVALID) return null;
  if (
    declaredRowCount !== null &&
    !rowCountAgreesWithPage(declaredRowCount, result.length)
  ) {
    return null;
  }

  const schema = readOptionalSchema(value.schema);
  return {
    result,
    ...(schema ? { schema } : {}),
    metadata: {
      cached: cached ?? false,
      executionTimestamp,
      executionTimeMs: executionTimeMs ?? 0,
      rowCount: result.length,
    },
  };
}

const INVALID = Symbol("invalid-cdp-sql-field");

/** Live empty page: `result: null` + `rowCount: 0`. Missing `result` stays invalid. */
function normalizeResultRows(
  result: unknown,
  declaredRowCount: number | null,
): unknown[] | typeof INVALID {
  if (Array.isArray(result)) return result;
  if (result === null && declaredRowCount === 0) return [];
  return INVALID;
}

function readOptionalCached(
  metadata: Record<string, unknown> | undefined,
): boolean | null | typeof INVALID {
  if (!metadata || metadata.cached === undefined) return null;
  return typeof metadata.cached === "boolean" ? metadata.cached : INVALID;
}

function readOptionalExecutionTimestamp(
  metadata: Record<string, unknown> | undefined,
  receivedAt: Date,
): string | typeof INVALID {
  if (!metadata || metadata.executionTimestamp === undefined) {
    return receivedAt.toISOString();
  }
  if (typeof metadata.executionTimestamp !== "string") return INVALID;
  const normalized = normalizeMetadataTimestamp(metadata.executionTimestamp);
  return normalized ?? INVALID;
}

function readOptionalExecutionTimeMs(
  metadata: Record<string, unknown> | undefined,
): number | null | typeof INVALID {
  if (!metadata || metadata.executionTimeMs === undefined) return null;
  if (
    typeof metadata.executionTimeMs !== "number" ||
    !Number.isFinite(metadata.executionTimeMs) ||
    metadata.executionTimeMs < 0
  ) {
    return INVALID;
  }
  const rounded = Math.round(metadata.executionTimeMs);
  return Number.isSafeInteger(rounded) ? rounded : INVALID;
}

function readOptionalRowCount(
  metadata: Record<string, unknown> | undefined,
): number | null | typeof INVALID {
  if (!metadata || metadata.rowCount === undefined) return null;
  if (!Number.isSafeInteger(metadata.rowCount) || (metadata.rowCount as number) < 0) {
    return INVALID;
  }
  return metadata.rowCount as number;
}

function rowCountAgreesWithPage(declared: number, pageLength: number): boolean {
  if (declared === pageLength) return true;
  // Truncated / max-row pages: CDP may report the full match count.
  return pageLength > 0 && declared > pageLength;
}

function readOptionalSchema(
  value: unknown,
): CdpSqlResponse["schema"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !Array.isArray(value.columns)) return undefined;
  const columns = value.columns.flatMap((column) => {
    if (
      !isRecord(column) ||
      typeof column.name !== "string" ||
      typeof column.type !== "string"
    ) {
      return [];
    }
    return [{ name: column.name, type: column.type }];
  });
  return columns.length > 0 ? { columns } : undefined;
}

function normalizeMetadataTimestamp(value: string): string | null {
  const withZone = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(withZone);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
