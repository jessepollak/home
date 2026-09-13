// Route contract.
// GET /api/actions/:id

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type {
  ActionKind,
  DerivedActionStatus,
  MoneyActionCall,
  MoneyActionAmount,
  MoneyActionOwner,
  PreparedMoneyAction,
} from "@/shared/money-actions/types";

export type ActionSummaryResponse = {
  title: string;
  amounts: MoneyActionAmount[] | unknown[];
  warnings: string[];
  expiresAt: string;
  quoteId?: string;
};

export type GetActionPendingResponse = {
  id: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  calls: MoneyActionCall[];
  expiresAt: string;
};

export type GetActionResponse = GetActionPendingResponse | {
  id: string;
  provider: string;
  kind: ActionKind;
  summary: ActionSummaryResponse;
  status: DerivedActionStatus;
  createdAt: string;
  confirmedAt: string;
  providerHandle?: string;
  transactionHash?: string;
  owner: MoneyActionOwner;
};

export function parsePendingActionResponse(
  value: unknown,
  id: string,
  active: VerifiedAccountSession,
): PreparedMoneyAction | null {
  if (
    !isRecord(value) ||
    value.id !== id ||
    value.kind !== "send" ||
    !isRecord(value.summary) ||
    typeof value.summary.title !== "string" ||
    !Array.isArray(value.summary.amounts) ||
    !Array.isArray(value.summary.warnings) ||
    !Array.isArray(value.calls) ||
    typeof value.expiresAt !== "string" ||
    !active.smartAccount
  ) {
    return null;
  }
  return {
    id,
    owner: {
      subject: active.user.subject,
      address: active.smartAccount.address,
      chainId: active.smartAccount.chainId,
      accountProvider: active.accountProvider,
    },
    kind: value.kind,
    title: value.summary.title,
    calls: value.calls as PreparedMoneyAction["calls"],
    amounts: value.summary.amounts as PreparedMoneyAction["amounts"],
    warnings: value.summary.warnings as string[],
    expiresAt: value.expiresAt,
    createdAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
