// Route contract.
// POST /api/actions/:id/confirm

import type { MoneyActionCall } from "@/shared/money-actions/types";
import type { ActionSummaryResponse } from "./get";

export type ConfirmActionRequest = { signature?: `0x${string}` };
export type ConfirmActionResponse = {
  id: string;
  calls: MoneyActionCall[];
  summary: ActionSummaryResponse;
  expiresAt: string;
  batchGasLimit?: string;
};

export function parseConfirmActionResponse(
  value: unknown,
): Pick<ConfirmActionResponse, "calls" | "batchGasLimit"> | null {
  if (!isRecord(value) || !Array.isArray(value.calls)) return null;
  if (value.batchGasLimit !== undefined && !isValidBatchGasLimit(value.batchGasLimit)) {
    return null;
  }
  return {
    calls: value.calls as ConfirmActionResponse["calls"],
    ...(value.batchGasLimit === undefined ? {} : { batchGasLimit: value.batchGasLimit }),
  };
}

function isValidBatchGasLimit(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return false;
  try {
    return BigInt(value) <= BigInt(2_000_000);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
