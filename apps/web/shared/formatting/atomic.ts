const MAX_TOKEN_DECIMALS = 255;
const DECIMAL_AMOUNT = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const ATOMIC_AMOUNT = /^[0-9]+$/;

export function decimalToAtomic(value: string, decimals: number): string {
  assertDecimals(decimals);
  const match = DECIMAL_AMOUNT.exec(value);
  if (!match) throw new Error("Decimal amount is invalid.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error("Decimal amount exceeds the asset precision.");
  return `${match[1]}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

export function atomicToDecimal(atomic: string | bigint, decimals: number): string {
  assertDecimals(decimals);
  const value = typeof atomic === "bigint" ? atomic.toString(10) : atomic;
  if (!ATOMIC_AMOUNT.test(value)) throw new Error("Atomic amount is invalid.");
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return normalized;
  const padded = normalized.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${padded.slice(0, -decimals)}.${fraction}` : padded.slice(0, -decimals);
}

function assertDecimals(decimals: number): void {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new Error("Asset decimals must be an integer between 0 and 255.");
  }
}
