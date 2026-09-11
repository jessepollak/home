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
