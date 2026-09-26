import { BASE_USDC_DECIMALS } from "@/shared/savings/config";
export function parseUsdcAmount(value: string): string {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim().replace(/\.$/, ""));
  if (!match) {
    throw new Error("Enter a positive USDC amount using decimal digits only.");
  }
  const fraction = match[2] ?? "";
  if (fraction.length > BASE_USDC_DECIMALS) {
    throw new Error("USDC supports at most 6 decimal places.");
  }
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const raw = BigInt(`${whole}${fraction.padEnd(BASE_USDC_DECIMALS, "0")}`);
  if (raw <= BigInt(0)) {
    throw new Error("Enter a positive USDC amount.");
  }
  return raw.toString(10);
}
