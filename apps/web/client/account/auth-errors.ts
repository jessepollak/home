const unavailableEmailSendErrorTypes = new Set([
  "internal_server_error",
  "bad_gateway",
  "service_unavailable",
  "timed_out",
  "endpoint_unavailable",
  "unknown",
]);

export function classifyEmailSendError(error: unknown): "provider-unavailable" | "rejected" {
  if (error instanceof TypeError) return "provider-unavailable";
  if (typeof error === "object" && error !== null) {
    if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 500) {
      return "provider-unavailable";
    }
    if ("errorType" in error && typeof error.errorType === "string" && unavailableEmailSendErrorTypes.has(error.errorType)) {
      return "provider-unavailable";
    }
  }
  return "rejected";
}

export type EmailCodeErrorKind = "invalid" | "expired" | "unavailable";

export function classifyEmailCodeError(error: unknown): EmailCodeErrorKind {
  if (!(error instanceof Error)) {
    return "unavailable";
  }

  const message = error.message.toLowerCase();
  if (message.includes("expired") || message.includes("expire")) {
    return "expired";
  }
  if (
    message.includes("invalid") ||
    message.includes("incorrect") ||
    message.includes("mismatch")
  ) {
    return "invalid";
  }

  return "unavailable";
}
