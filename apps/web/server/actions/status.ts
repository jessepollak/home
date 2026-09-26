import "server-only";

import type { DerivedActionStatus } from "@/shared/money-actions/types";
import type { ActionOutcome } from "./store";

export type ActionReceiptState = "pending" | "confirmed" | "failed" | "unavailable" | "unattributed";
export type { DerivedActionStatus } from "@/shared/money-actions/types";

const UNKNOWN_AFTER_MS = 15 * 60_000;

export function deriveActionStatus(input: {
  confirmedAt: string;
  submittedAt?: string | null;
  transactionHash: string | null;
  receipt: ActionReceiptState | null;
  outcome: ActionOutcome | null;
  now?: Date;
}): DerivedActionStatus {
  if (input.outcome) return input.outcome === "succeeded" ? "confirmed" : "failed";
  if (input.transactionHash) {
    if (input.receipt === "pending" || input.receipt === "confirmed" || input.receipt === "failed") return input.receipt;
    if (input.receipt === "unattributed") return "unknown";
  }
  const windowStart = Date.parse(input.submittedAt ?? input.confirmedAt);
  const now = (input.now ?? new Date()).getTime();
  return Number.isFinite(windowStart) && now - windowStart < UNKNOWN_AFTER_MS
    ? "pending"
    : "unknown";
}
