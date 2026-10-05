import { formatUnits } from "viem";

export const MAX_AMOUNT_DECIMALS = 255;
export const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

export type DecimalAmountFailure = "invalid" | "precision" | "zero" | "overflow" | "decimals";

export class DecimalAmountError extends TypeError {
  readonly reason: DecimalAmountFailure;

  constructor(reason: DecimalAmountFailure, message: string) {
    super(message);
    this.name = "DecimalAmountError";
    this.reason = reason;
  }
}

export function parseDecimalAmount(value: string, decimals: number): bigint {
  validateDecimals(decimals);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match || match[0] !== value) {
    throw new DecimalAmountError("invalid", "Decimal amount is invalid.");
  }
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new DecimalAmountError("precision", "Decimal amount exceeds the asset precision.");
  }
  return BigInt(whole) * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function parsePositiveAmount(value: string, decimals: number): bigint {
  const amount = parseDecimalAmount(value, decimals);
  if (amount === BigInt(0)) {
    throw new DecimalAmountError("zero", "Amount must be greater than zero.");
  }
  if (amount > UINT256_MAX) {
    throw new DecimalAmountError("overflow", "Amount exceeds the maximum supported value.");
  }
  return amount;
}

export function formatDecimalAmount(value: bigint, decimals: number): string {
  validateDecimals(decimals);
  if (value < BigInt(0)) {
    throw new DecimalAmountError("invalid", "Amount must not be negative.");
  }
  return formatUnits(value, decimals);
}

export function readPositiveDecimal(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return String(value);
  }
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const mantissa = value.split(/[eE]/, 1)[0] ?? "";
  return /[1-9]/.test(mantissa) ? value : null;
}

function validateDecimals(decimals: number): void {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > MAX_AMOUNT_DECIMALS) {
    throw new DecimalAmountError("decimals", "Asset decimals must be an integer between 0 and 255.");
  }
}
