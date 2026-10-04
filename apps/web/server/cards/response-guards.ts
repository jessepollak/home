import "server-only";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStringEnum<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function matchesId(value: unknown, pattern: RegExp): value is string {
  if (pattern.global) pattern.lastIndex = 0;
  return typeof value === "string" && pattern.test(value);
}
