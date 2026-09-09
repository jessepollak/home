/**
 * Codex 24h change is a decimal ratio (`0.05` → +5%). Same convention as
 * `filterTokens.change24` and `getTokenPrices.priceChange24`.
 * Missing, zero, or malformed values are omitted — never invented.
 */
export function formatChangeLabel(value: unknown): string | undefined {
  const decimal = readSignedDecimal(value);
  if (decimal === null || decimal === 0) return undefined;
  const percent = decimal * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function readSignedDecimal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
