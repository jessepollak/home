import "server-only";

import type { DerivedActionStatus } from "@/shared/money-actions/types";

export type ActionReceiptState = "pending" | "confirmed" | "failed" | "unavailable";
export type { DerivedActionStatus } from "@/shared/money-actions/types";

const UNKNOWN_AFTER_MS = 15 * 60_000;

export function deriveActionStatus(input: {
  confirmedAt: string;
  transactionHash: string | null;
  receipt: ActionReceiptState | null;
  now?: Date;
}): DerivedActionStatus {
  if (input.transactionHash) {
    if (input.receipt === "confirmed") return "confirmed";
    if (input.receipt === "failed") return "failed";
    if (input.receipt === "pending") return "pending";
    return "unknown";
  }
  const confirmedAt = Date.parse(input.confirmedAt);
  const now = (input.now ?? new Date()).getTime();
  return Number.isFinite(confirmedAt) && now - confirmedAt < UNKNOWN_AFTER_MS
    ? "pending"
    : "unknown";
}
