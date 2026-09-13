// Route contract.
// GET /api/actions

import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { ActionSummaryResponse } from "./get";
import {
  isActionKind,
  type ActionKind,
  type DerivedActionStatus,
  type MoneyActionAmount,
  type MoneyActionOwner,
} from "@/shared/money-actions/types";

export type ActionListItem = {
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
export type ListActionsResponse = { actions: ActionListItem[] };

export type RecentMoneyActionOperation = {
  action: {
    id: string;
    kind: ActionKind;
    title: string;
    amounts: MoneyActionAmount[];
    warnings: string[];
    expiresAt: string;
    quoteId?: string;
    createdAt: string;
  };
  status: DerivedActionStatus;
  transactionHash?: `0x${string}`;
  userOperationHash?: `0x${string}`;
  createdAt: string;
  updatedAt: string;
};

export function parseRecentMoneyActions(value: unknown, session: VerifiedAccountSession): RecentMoneyActionOperation[] {
  if (!session.smartAccount || !isRecord(value) || !Array.isArray(value.actions)) return [];
  const parsed: RecentMoneyActionOperation[] = [];
  for (const item of value.actions) {
    if (!isRecord(item) || !isRecord(item.owner) || !isRecord(item.summary)) continue;
    if (item.owner.subject !== session.user.subject || item.owner.accountProvider !== session.accountProvider ||
      typeof item.owner.address !== "string" || item.owner.address.toLowerCase() !== session.smartAccount.address.toLowerCase()) continue;
    if (typeof item.id !== "string" || !isActionKind(item.kind) || !isDerivedStatus(item.status) ||
      typeof item.createdAt !== "string" || typeof item.confirmedAt !== "string" || typeof item.summary.title !== "string" ||
      !Array.isArray(item.summary.amounts) || !Array.isArray(item.summary.warnings) || typeof item.summary.expiresAt !== "string") continue;
    parsed.push({
      action: {
        id: item.id,
        kind: item.kind,
        title: item.summary.title,
        amounts: item.summary.amounts as MoneyActionAmount[],
        warnings: item.summary.warnings as string[],
        expiresAt: item.summary.expiresAt,
        ...(typeof item.summary.quoteId === "string" ? { quoteId: item.summary.quoteId } : {}),
        createdAt: item.createdAt,
      },
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.confirmedAt,
      ...(typeof item.transactionHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(item.transactionHash) ? { transactionHash: item.transactionHash.toLowerCase() as `0x${string}` } : {}),
      ...(typeof item.providerHandle === "string" && /^0x[0-9a-fA-F]{64}$/.test(item.providerHandle) ? { userOperationHash: item.providerHandle.toLowerCase() as `0x${string}` } : {}),
    });
  }
  return parsed.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function dedupeRecentMoneyActions(
  operations: RecentMoneyActionOperation[],
  excluded: ReadonlySet<string>,
) {
  return operations.filter((operation) => !operation.transactionHash || !excluded.has(operation.transactionHash.toLowerCase()));
}

function isDerivedStatus(value: unknown): value is DerivedActionStatus {
  return value === "pending" || value === "unknown" || value === "confirmed" || value === "failed";
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
