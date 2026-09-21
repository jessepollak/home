import "server-only";

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
