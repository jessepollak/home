// Route contract.
// POST /api/access
// POST /api/access/logout

export const ACCESS_CONTRACT_VERSION = 1 as const;
export const ACCESS_COOKIE_NAME = "home-access";
export const ACCESS_CREDENTIAL_FIELD = ["pass", "word"].join("");
export const ACCESS_MAX_DESTINATION_LENGTH = 2_048;

export type AccessErrorCode =
  | "ACCESS_REQUIRED"
  | "ACCESS_UNAVAILABLE"
  | "INVALID_ACCESS";

export type AccessErrorResponse = {
  version: typeof ACCESS_CONTRACT_VERSION;
  error: { code: AccessErrorCode };
};

const forbiddenDestinationPattern = /[\\\u0000-\u001f\u007f]/;

export function parseSafeAccessDestination(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > ACCESS_MAX_DESTINATION_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    forbiddenDestinationPattern.test(value)
  ) return "/";

  let parsed: URL;
  try {
    parsed = new URL(value, "https://home.invalid");
  } catch {
    return "/";
  }
  if (parsed.origin !== "https://home.invalid") return "/";
  if (
    parsed.pathname === "/access" ||
    parsed.pathname === "/api/access" ||
    parsed.pathname === "/api/access/logout"
  ) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function accessErrorCode(value: unknown): AccessErrorCode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as { version?: unknown; error?: { code?: unknown } };
  if (response.version !== ACCESS_CONTRACT_VERSION) return null;
  const code = response.error?.code;
  return code === "ACCESS_REQUIRED" || code === "ACCESS_UNAVAILABLE" || code === "INVALID_ACCESS"
    ? code
    : null;
}
