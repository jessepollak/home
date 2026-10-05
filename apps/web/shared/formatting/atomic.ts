import { DecimalAmountError, formatDecimalAmount, parseDecimalAmount } from "@/shared/amounts/decimal";

export function decimalToAtomic(value: string, decimals: number): string {
  try {
    return parseDecimalAmount(value, decimals).toString(10);
  } catch (error) {
    if (error instanceof DecimalAmountError) throw new Error(error.message);
    throw error;
  }
}

export function atomicToDecimal(value: string | bigint, decimals: number): string {
  if (typeof value === "bigint" ? value < BigInt(0) : typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error("Atomic amount is invalid.");
  }
  try {
    return formatDecimalAmount(BigInt(value), decimals);
  } catch (error) {
    if (error instanceof DecimalAmountError) throw new Error(error.message);
    throw error;
  }
}
