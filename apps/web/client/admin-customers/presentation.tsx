import { decimalToAtomic } from "@/shared/formatting/atomic";
import { formatPresentationCashAmount } from "@/shared/formatting/money";
import type { CustomerEmail, CustomerSearchRow } from "@/shared/admin-customers/contract";

export function emailSourceLabel(source: CustomerEmail["source"]): string {
  return source === "cdp_verified" ? "Verified" : "Wallet-reported";
}

export function signInLabel(provider: CustomerSearchRow["signIn"][number]): string {
  return provider === "cdp-embedded" ? "Email" : "Base Account";
}

export function statusLabel(status: CustomerSearchRow["status"]): string {
  return status === "active" ? "Active" : status === "restricted" ? "Restricted" : "Closed";
}

export function formatDay(iso: string): string {
  return iso.slice(0, 10);
}

export function formatMoment(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function formatUsd(value: string | null): string {
  if (value === null) return "Unavailable";
  const negative = value.startsWith("-");
  const magnitude = negative ? value.slice(1) : value;
  const scale = Math.max(2, magnitude.split(".")[1]?.length ?? 0);
  const formatted = formatPresentationCashAmount(decimalToAtomic(magnitude, scale), scale, "USD", { regionId: "US" });
  return negative ? `−${formatted}` : formatted;
}

export function CustomerAccessLost({ reason }: { reason: "signed-out" | "forbidden" }) {
  return (
    <div role="alert" className="grid gap-2">
      <p>{reason === "signed-out" ? "Your session ended. Sign in again to view customers." : "This account can no longer view customers."}</p>
      <a href={reason === "signed-out" ? "/admin" : "/home"} className="w-fit font-medium text-primary underline-offset-4 hover:underline">{reason === "signed-out" ? "Sign in again" : "Go to Home"}</a>
    </div>
  );
}
