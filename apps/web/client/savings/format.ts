import { DecimalAmountError, parsePositiveAmount } from "@/shared/amounts/decimal";
import { BASE_USDC_DECIMALS } from "@/shared/savings/config";

export function parseUsdcAmount(value: string): string {
  try {
    return parsePositiveAmount(
      value.trim().replace(/\.$/, "").replace(/^0+(?=\d)/, ""),
      BASE_USDC_DECIMALS,
    ).toString(10);
  } catch (error) {
    if (!(error instanceof DecimalAmountError)) throw error;
    if (error.reason === "precision") throw new Error("USDC supports at most 6 decimal places.");
    if (error.reason === "zero") throw new Error("Enter a positive USDC amount.");
    throw new Error("Enter a positive USDC amount using decimal digits only.");
  }
}
