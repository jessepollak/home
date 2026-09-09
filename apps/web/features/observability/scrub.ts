export const REDACTED = "[REDACTED]";

const sensitiveKeyPattern =
  /^(authorization|cookie|set-cookie|access[_-]?token|api[_-]?key(?:[_-]?secret)?|api[_-]?secret|client[_-]?secret|cdp[_-]?api[_-]?key(?:[_-]?id|_secret)?|otp|one[_-]?time[_-]?code|password|secret|token|refresh[_-]?token)$/i;

const jwtPattern = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
const bearerPattern = /Bearer[\t ]+\S+/gi;
const authorizationAssignmentPattern =
  /(authorization\s*[:=]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
const secretAssignmentPattern =
  /((?:access[_-]?token|api[_-]?key(?:[_-]?secret)?|client[_-]?secret|cdp[_-]?api[_-]?key[_-]?secret|otp|one[_-]?time(?:[_-]?code)?|refresh[_-]?token|password)\s*[:=]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
const secretQueryPattern =
  /([?&](?:access_token|authorization|code|otp|refresh_token|token)=)[^&]*/gi;
const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key.trim());
}

export function scrubString(value: string): string {
  return value
    .replace(bearerPattern, `Bearer ${REDACTED}`)
    .replace(jwtPattern, REDACTED)
    .replace(authorizationAssignmentPattern, `$1${REDACTED}`)
    .replace(secretAssignmentPattern, `$1${REDACTED}`)
    .replace(secretQueryPattern, `$1${REDACTED}`)
    .replace(emailPattern, REDACTED);
}

export function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry));
  }
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      record[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entry);
    }
    return record;
  }
  return value;
}

export function sanitizePathname(path: string): string {
  const pathname = path.split("?")[0]?.split("#")[0] ?? "/";
  if (!pathname.startsWith("/")) {
    return "/";
  }
  return pathname.slice(0, 256);
}
