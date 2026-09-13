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
};

export function parseConfirmActionResponse(
  value: unknown,
): Pick<ConfirmActionResponse, "calls"> | null {
  if (!isRecord(value) || !Array.isArray(value.calls)) return null;
  return { calls: value.calls as ConfirmActionResponse["calls"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
