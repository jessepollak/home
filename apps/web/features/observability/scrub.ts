export const REDACTED = "[REDACTED]";
export const REDACTED_URL = "[URL]";

const MAX_SCRUB_INPUT_CHARS = 4_096;
const MAX_SCRUB_OUTPUT_CHARS = 2_048;
const MAX_ROUTE_CHARS = 192;
const MAX_ROUTE_SEGMENT_CHARS = 48;
const MAX_PATH_SEGMENT_DECODE_PASSES = 3;

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
  `\\b(authorization|proxy[_-]?authorization|cookie|set[_-]?cookie)(\\s*[:=])[^\\r\\n]*`,
  "gi",
);
const sensitiveAssignmentPattern = new RegExp(
  `(["']?(?:${sensitiveKeySource})["']?\\s*[:=]\\s*)`,
  "gi",
);
const bearerOrBasicPattern = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/g;
const privateKeyPattern = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi;
const absoluteUrlPattern = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi;
const embeddedPathBoundarySource = `[\\s"'=:(\\[\\]{}]`;
const protocolRelativeUrlPattern = /(^|[\s"'=:(])\/\/[^\s"'<>]+/g;
const absolutePathReferencePattern = new RegExp(
  `(^|${embeddedPathBoundarySource})(\\/(?!\\/)[^\\s"'<>\\[\\]{}]*)`,
  "g",
);
const relativeSlashPathPattern = new RegExp(
  `(^|${embeddedPathBoundarySource})((?:\\.{1,2}\\/)?[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\\/[A-Za-z0-9._~!$&'()*+,;=:@%\\/-]+)+)`,
  "g",
);
const relativeQueryOrHashPattern = new RegExp(
  `(^|${embeddedPathBoundarySource})((?:(?:\\.{1,2}\\/)*[A-Za-z0-9._~-]+(?:\\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*)?[?#][^\\s"'<>\\[\\]{}]*)`,
  "g",
);
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

function redactCredentialHeaders(value: string): string {
  return value.replace(
    headerCredentialPattern,
    (_match, key: string, separator: string) => `${key}${separator} ${REDACTED}`,
  );
}

function findQuotedValueEnd(value: string, start: number, quote: string): number {
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === quote) return index + 1;
  }
  return value.length;
}

function findStructuredValueEnd(value: string, start: number): number {
  const stack = [value[start]];
  let quote: string | null = null;

  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character === "}" || character === "]") {
      const opener = stack.at(-1);
      if (
        (opener === "{" && character !== "}") ||
        (opener === "[" && character !== "]")
      ) {
        return value.length;
      }
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }

  return value.length;
}

function redactSensitiveAssignments(value: string): string {
  let cursor = 0;
  let output = "";
  sensitiveAssignmentPattern.lastIndex = 0;

  while (true) {
    const match = sensitiveAssignmentPattern.exec(value);
    if (!match) break;
    const matchStart = match.index;
    if (matchStart < cursor) continue;

    const prefix = match[0];
    const valueStart = matchStart + prefix.length;
    const first = value[valueStart];
    let valueEnd = valueStart;
    let replacement = REDACTED;

    if (first === '"' || first === "'") {
      valueEnd = findQuotedValueEnd(value, valueStart, first);
      replacement = `${first}${REDACTED}${first}`;
    } else if (first === "{" || first === "[") {
      valueEnd = findStructuredValueEnd(value, valueStart);
    } else {
      while (valueEnd < value.length && !/[\s,;&}\]]/.test(value[valueEnd] ?? "")) {
        valueEnd += 1;
      }
    }

    output += value.slice(cursor, matchStart) + prefix + replacement;
    cursor = valueEnd;
    sensitiveAssignmentPattern.lastIndex = valueEnd;
  }

  return output + value.slice(cursor);
}

function decodedSensitiveKey(segment: string): boolean {
  let candidate = segment;

  for (let pass = 0; pass < MAX_PATH_SEGMENT_DECODE_PASSES; pass += 1) {
    if (isSensitiveKey(candidate)) return true;
    if (!candidate.includes("%")) return false;

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    } catch {
      return true;
    }
  }

  if (isSensitiveKey(candidate)) return true;
  return candidate.includes("%");
}

function sanitizePathname(pathname: string, maxChars: number): string {
  let redactNextSegment = false;
  const segments = pathname.split("/").map((segment, index) => {
    if (segment.length === 0) return "";

    if (redactNextSegment) {
      redactNextSegment = false;
      return ":redacted";
    }

    if (decodedSensitiveKey(segment)) {
      redactNextSegment = true;
      return ":redacted";
    }

    if (
      segment.length > MAX_ROUTE_SEGMENT_CHARS ||
      segment.includes("%") ||
      !safeRouteSegmentPattern.test(segment) ||
      sensitiveRouteSegmentPattern.test(segment)
    ) {
      return ":redacted";
    }

    return index === 0 && segment === "." ? "." : segment;
  });

  return segments.join("/").replace(/\/{2,}/g, "/").slice(0, maxChars);
}

function pathHasSensitiveKey(reference: string): boolean {
  const pathname = reference.split(/[?#]/, 1)[0] ?? "";
  return pathname.split("/").some(decodedSensitiveKey);
}

function sanitizeEmbeddedReference(reference: string): string {
  const pathname = reference.split(/[?#]/, 1)[0] ?? "";
  if (!pathname) return REDACTED_URL;
  return sanitizePathname(pathname, MAX_SCRUB_OUTPUT_CHARS) || REDACTED_URL;
}

function redactPathReferences(value: string): string {
  return value
    .replace(
      absolutePathReferencePattern,
      (_match, boundary: string, reference: string) =>
        `${boundary}${sanitizeEmbeddedReference(reference)}`,
    )
    .replace(
      relativeSlashPathPattern,
      (match, boundary: string, reference: string) =>
        pathHasSensitiveKey(reference)
          ? `${boundary}${sanitizeEmbeddedReference(reference)}`
          : match,
    )
    .replace(
      relativeQueryOrHashPattern,
      (_match, boundary: string, reference: string) =>
        `${boundary}${sanitizeEmbeddedReference(reference)}`,
    );
}

export function scrubString(value: string): string {
  const bounded = value.slice(0, MAX_SCRUB_INPUT_CHARS).replace(controlPattern, " ");

  return redactSensitiveAssignments(
    redactPathReferences(
      redactCredentialHeaders(
        bounded
          .replace(privateKeyPattern, REDACTED)
          .replace(absoluteUrlPattern, REDACTED_URL)
          .replace(protocolRelativeUrlPattern, `$1${REDACTED_URL}`),
      ),
    ),
  )
    .replace(bearerOrBasicPattern, REDACTED)
    .replace(jwtPattern, REDACTED)
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
  return sanitizePathname(pathname, MAX_ROUTE_CHARS) || "/";
}

export function sanitizeIdentifier(value: string, fallback: string): string {
  const scrubbed = scrubString(value).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(scrubbed)) {
    return fallback;
  }
  return scrubbed;
}
