import "server-only";

export function classifyProviderRefusal(status: number, body: unknown): "token-not-routed" | null {
  if (status !== 400 || typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const error = body as Record<string, unknown>;
  if (error.errorType !== "invalid_request" || typeof error.errorMessage !== "string") return null;
  return /^The token you['’]re trying to (?:buy|sell) isn['’]t authorized for this swap\.$/.test(error.errorMessage)
    ? "token-not-routed" : null;
}
