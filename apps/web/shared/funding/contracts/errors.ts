export const FUNDING_ERROR_CODES = [
  "AMBIGUOUS_AUTHENTICATION",
  "AMBIGUOUS_ORDER_OPEN",
  "AUTH_UNAVAILABLE",
  "BASE_ACCOUNT_DISABLED",
  "CORRIDOR_NOT_OFFERED",
  "CUSTOMER_CREATION_IN_PROGRESS",
  "CUSTOMER_NOT_READY",
  "CUSTOMER_VERIFICATION_REQUIRED",
  "CUSTOMERS_UNAVAILABLE",
  "FUNDING_NOT_CONFIGURED",
  "INVALID_ACCOUNT_PROVIDER",
  "INVALID_AMOUNT",
  "INVALID_DIRECTION",
  "INVALID_ORDER_REQUEST",
  "INVALID_ORDER_RESOLUTION_REQUEST",
  "INVALID_PROVIDER_QUOTE",
  "INVALID_QUOTE_REQUEST",
  "INVALID_QUOTE_TOKEN",
  "INVALID_REGION",
  "INVALID_VERIFICATION_REQUEST",
  "ORDER_NOT_AMBIGUOUS",
  "ORDER_NOT_FOUND",
  "ORDER_RECOVERY_TIME_INVALID",
  "ORDER_RESOLUTION_NOT_READY",
  "ORDER_STATE_CHANGED",
  "ORDER_UNAVAILABLE",
  "PROVIDERS_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "QUOTE_BELOW_MINIMUM",
  "QUOTE_DECLINED",
  "QUOTE_UNAVAILABLE",
  "SMART_ACCOUNT_UNAVAILABLE",
  "UNAUTHENTICATED",
  "VERIFICATION_ALREADY_STARTED",
  "VERIFICATION_UNAVAILABLE",
] as const;

export type FundingErrorCode = (typeof FUNDING_ERROR_CODES)[number];
export type FundingErrorResponse = { error: { code: FundingErrorCode; message: string } };

export function isFundingErrorCode(value: unknown): value is FundingErrorCode {
  return typeof value === "string" && FUNDING_ERROR_CODES.some((code) => code === value);
}

export function fundingErrorBody(code: FundingErrorCode, message: string): FundingErrorResponse {
  return { error: { code, message } };
}

/** @public parses funding route errors for account clients */
export function readFundingErrorResponse(value: unknown): FundingErrorResponse | null {
  if (!record(value) || Object.keys(value).length !== 1 || !record(value.error) ||
    Object.keys(value.error).length !== 2 || !Object.hasOwn(value.error, "code") || !Object.hasOwn(value.error, "message") ||
    !isFundingErrorCode(value.error.code) || typeof value.error.message !== "string" ||
    value.error.message.length === 0 || value.error.message.length > 2000) return null;
  return fundingErrorBody(value.error.code, value.error.message);
}

export function readFundingFailure(value: unknown): { code: FundingErrorCode; message: string | null } | null {
  if (!record(value) || !isFundingErrorCode(value.code)) return null;
  const message = typeof value.serverMessage === "string" && value.serverMessage.length > 0 && value.serverMessage.length <= 200
    ? value.serverMessage : null;
  return { code: value.code, message };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
