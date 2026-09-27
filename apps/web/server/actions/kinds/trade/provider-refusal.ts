import "server-only";

export function classifyProviderRefusal(status: number, body: unknown): "token-not-routed" | "below-minimum" | "route-unavailable" | null {
  if (![400, 404, 422].includes(status) || typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const error = body as Record<string, unknown>;
  if (typeof error.errorType !== "string" || typeof error.errorMessage !== "string") return null;
  if (status === 400 && error.errorType === "invalid_request" &&
    /^The token you['’]re trying to (?:buy|sell) isn['’]t authorized for this swap\.$/.test(error.errorMessage)) return "token-not-routed";
  return /(?:minimum|min_amount|amount.too.small|below.threshold)/i.test(`${error.errorType} ${error.errorMessage}`)
    ? "below-minimum" : "route-unavailable";
}
