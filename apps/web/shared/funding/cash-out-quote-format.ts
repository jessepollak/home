import type { RegionId } from "@/config/regions";
import type { CashoutFee, CashoutQuote } from "./cash-out-quote";
import { formatQuotedAmount } from "./quoted-amount-format";

export function formatCashoutReceive(receive: CashoutQuote["receive"], platformLabel: string, regionId: RegionId): string {
  return `${receive.approximate ? "≈ " : ""}${formatQuotedAmount(receive.amount, receive.currency, { regionId })} to ${platformLabel}`;
}

export function formatCashoutFee(fee: CashoutFee | null, regionId: RegionId): string {
  if (fee === null) return "Not quoted";
  if (/^0(?:\.0+)?$/.test(fee.amount)) return "None";
  return formatQuotedAmount(fee.amount, fee.currency, { regionId });
}

export function formatCashoutRate(rate: CashoutQuote["rate"]): string | null {
  if (rate === null) return null;
  const [whole, fraction = ""] = rate.value.split(".");
  const rounded = BigInt(whole) * BigInt(10000) + BigInt((fraction + "0000").slice(0, 4)) +
    (Number(fraction[4] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
  const remainder = rounded % BigInt(10000);
  const value = `${rounded / BigInt(10000)}${remainder === BigInt(0) ? "" : `.${String(remainder).padStart(4, "0").replace(/0+$/, "")}`}`;
  return `1 ${rate.from} = ${rounded === BigInt(0) ? "<0.0001" : value} ${rate.to}`;
}
