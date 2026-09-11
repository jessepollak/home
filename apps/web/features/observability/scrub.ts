export const REDACTED = "[REDACTED]";
export const REDACTED_URL = "[URL]";

const MAX_SCRUB_INPUT_CHARS = 4_096;
const MAX_SCRUB_OUTPUT_CHARS = 2_048;
const MAX_ROUTE_CHARS = 192;
const MAX_ROUTE_SEGMENT_CHARS = 48;

const sensitiveKeySource = [
  "authorization",
  "proxy[_-]?authorization",
  "cookie",
  "set[_-]?cookie",
  "password",
  "passwd",
  "passcode",
  "pin",
  "otp",
  "one[_-]?time(?:[_-]?(?:code|password))?",
  "token",
  "access[_-]?token",
  "refresh[_-]?token",
  "id[_-]?token",
  "api[_-]?key",
  "api[_-]?secret",
  "client[_-]?secret",
  "private[_-]?key",
  "secret",
  "session[_-]?(?:id|token|secret)",
  "cdp[_-]?(?:api[_-]?)?(?:key(?:[_-]?secret)?|secret|token)",
].join("|");

const sensitiveKeyPattern = new RegExp(`^(?:${sensitiveKeySource})$`, "i");
const headerCredentialPattern = new RegExp(
  `\\b(authorization|proxy[_-]?authorization|cookie|set[_-]?cookie)\\s*[:=]\\s*[^\\r\\n,}]*`,
  "gi",
);
const quotedCredentialPattern = new RegExp(
  `(["']?(?:${sensitiveKeySource})["']?\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\2).)*\\2`,
  "gi",
);
const bareCredentialPattern = new RegExp(
  `(["']?(?:${sensitiveKeySource})["']?\\s*[:=]\\s*)(?!["'])[^\\s,;&}]+`,
  "gi",
);
const bearerOrBasicPattern = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/g;
const privateKeyPattern = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi;
const absoluteUrlPattern = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const protocolRelativeUrlPattern = /(^|[\s"'=:(])\/\/[^\s"'<>]+/g;
const relativeQueryOrHashPattern = /(^|[\s"'=:(])(\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*)(?:\?[^\s"'<>#]*|#[^\s"'<>]*)+/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const secretPrefixPattern = /\b(?:sk|pk|secret|token)[-_][A-Za-z0-9_-]{12,}\b/gi;
const highEntropyPattern = /\b(?=[A-Za-z0-9_+/=-]{24,}\b)(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]+\b/g;
const otpPattern = /\b\d{6}\b/g;
const controlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const safeRouteSegmentPattern = /^[A-Za-z0-9._~-]+$/;
const sensitiveRouteSegmentPattern = /^(?:0x[a-f0-9]{16,}|\d{6,}|[A-Za-z0-9_-]{24,}|[^/]*@[^/]*)$/i;

export function isSensitiveKey(key: string): boolean {
  const normalized = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return sensitiveKeyPattern.test(normalized);
}

export function scrubString(value: string): string {
  const bounded = value.slice(0, MAX_SCRUB_INPUT_CHARS).replace(controlPattern, " ");

  return bounded
    .replace(privateKeyPattern, REDACTED)
    .replace(absoluteUrlPattern, REDACTED_URL)
    .replace(protocolRelativeUrlPattern, `$1${REDACTED_URL}`)
    .replace(relativeQueryOrHashPattern, "$1$2")
    .replace(headerCredentialPattern, "$1: [REDACTED]")
    .replace(bearerOrBasicPattern, REDACTED)
    .replace(jwtPattern, REDACTED)
    .replace(quotedCredentialPattern, `$1$2${REDACTED}$2`)
    .replace(bareCredentialPattern, `$1${REDACTED}`)
    .replace(secretPrefixPattern, REDACTED)
    .replace(emailPattern, REDACTED)
    .replace(otpPattern, REDACTED)
    .replace(highEntropyPattern, REDACTED)
    .slice(0, MAX_SCRUB_OUTPUT_CHARS);
}

export function sanitizeRoutePath(value: string): string {
  const candidate = value.slice(0, 1_024).trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("://")) {
    return "/";
  }

  const pathname = candidate.split(/[?#]/, 1)[0] ?? "/";
  const segments = pathname.split("/").map((segment, index) => {
    if (index === 0 || segment.length === 0) return "";
    if (
      segment.length > MAX_ROUTE_SEGMENT_CHARS ||
      segment.includes("%") ||
      !safeRouteSegmentPattern.test(segment) ||
      sensitiveRouteSegmentPattern.test(segment) ||
      isSensitiveKey(segment)
    ) {
      return ":redacted";
    }
    return segment;
  });

  const sanitized = segments.join("/").replace(/\/{2,}/g, "/");
  return (sanitized || "/").slice(0, MAX_ROUTE_CHARS);
}

export function sanitizeIdentifier(value: string, fallback: string): string {
  const scrubbed = scrubString(value).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(scrubbed)) {
    return fallback;
  }
  return scrubbed;
}
