"use client";

import { dataOwnerKey } from "@/client/account/owner-keys";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { PreparedMoneyAction, DerivedActionStatus, MoneyActionOwner } from "@/shared/money-actions/types";
import { fetchRecentActions, recentActionsQueryOptions } from "./recent-actions-query";

type Submission = "submitted" | "ambiguous" | "failed";
type MoneyResultStatus = "success" | "pending" | "failed" | "unknown";
type ResultRow = { id: string; status: DerivedActionStatus; owner: MoneyActionOwner };

export function moneyResultOutcome({ submission, row }: { submission: Submission; row?: Pick<ResultRow, "status"> }): MoneyResultStatus {
  if (submission === "failed") return "failed";
  if (row?.status === "confirmed") return "success";
  if (row?.status === "failed") return "failed";
  if (row?.status === "unknown" || submission === "ambiguous") return "unknown";
  return "pending";
}

function ownerKeyForAction(action: PreparedMoneyAction): string {
  return dataOwnerKey({
    subject: action.owner.subject,
    smartAccountAddress: action.owner.address,
    chainId: action.owner.chainId,
    accountProvider: action.owner.accountProvider,
  });
}

function matchingRow(value: unknown, action: PreparedMoneyAction): ResultRow | undefined {
  if (!value || typeof value !== "object" || !("actions" in value) || !Array.isArray(value.actions)) return undefined;
  const ownerKey = ownerKeyForAction(action);
  return value.actions.find((candidate: unknown): candidate is ResultRow => {
    if (!candidate || typeof candidate !== "object" || !("owner" in candidate) || !("id" in candidate) || !("status" in candidate)) return false;
    const row = candidate as Record<string, unknown>;
    const owner = row.owner;
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) return false;
    const fields = owner as Record<string, unknown>;
    if (typeof fields.subject !== "string" || typeof fields.address !== "string" || typeof fields.chainId !== "number" ||
      typeof fields.accountProvider !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(fields.address)) return false;
    return row.id === action.id &&
      (row.status === "pending" || row.status === "confirmed" || row.status === "failed" || row.status === "unknown") &&
      dataOwnerKey({ subject: fields.subject, smartAccountAddress: fields.address as `0x${string}`, chainId: fields.chainId, accountProvider: fields.accountProvider }) === ownerKey;
  });
}

export function useMoneyActionOutcome({ action, submission, fetchOperations }: {
  action: PreparedMoneyAction;
  submission: Submission;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
}): { outcome: MoneyResultStatus; row?: ResultRow } {
  const ownerKey = ownerKeyForAction(action);
  const actions = useHomeQuery({
    queryKey: ownerQueryKey(ownerKey, "actions"),
    enabled: submission !== "failed",
    ...recentActionsQueryOptions,
    meta: ownerQueryMeta(ownerKey, "owner"),
    queryFn: ({ signal }) => fetchRecentActions(fetchOperations, signal),
    refetchInterval: (query) => {
      const outcome = moneyResultOutcome({ submission, row: matchingRow(query.state.data, action) });
      return outcome === "pending" || outcome === "unknown" ? 5_000 : false;
    },
  });
  const row = matchingRow(actions.data, action);
  return { outcome: moneyResultOutcome({ submission, row }), ...(row ? { row } : {}) };
}
