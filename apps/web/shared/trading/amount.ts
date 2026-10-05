import { DecimalAmountError, parsePositiveAmount } from "@/shared/amounts/decimal";

export function parseTradeAmount(value: string, decimals: number): string | null {
  try {
    return parsePositiveAmount(
      value.trim().replace(/\.$/, "").replace(/^0+(?=\d)/, ""),
      decimals,
    ).toString(10);
  } catch (error) {
    if (error instanceof DecimalAmountError) return null;
    throw error;
  }
}
