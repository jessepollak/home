export function parseCdpCorrelationId(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(value)
    ? value : null;
}
