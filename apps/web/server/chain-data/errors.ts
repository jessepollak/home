import "server-only";

export type ChainDataErrorCode =
  | "invalid-input"
  | "invalid-response"
  | "not-configured"
  | "unauthorized"
  | "payment-required"
  | "rate-limited"
  | "timed-out"
  | "upstream-error";

export type SqlRejectionReason = "resource-limit" | "invalid-query" | "invalid-request" | "unknown";

export class ChainDataError extends Error {
  readonly code: ChainDataErrorCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly sqlRejectionReason: SqlRejectionReason | null;

  constructor(
    code: ChainDataErrorCode,
    message: string,
    options: {
      status?: number | null;
      retryAfterMs?: number | null;
      cause?: unknown;
      sqlRejectionReason?: SqlRejectionReason;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ChainDataError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.sqlRejectionReason = options.sqlRejectionReason ?? null;
  }
}
