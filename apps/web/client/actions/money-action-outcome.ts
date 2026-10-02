"use client";

import { skipToken } from "@tanstack/react-query";
import { useEffect } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { browserHomeQueryClient, ownerQueryKey, ownerQueryMeta, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import type { PreparedMoneyAction, DerivedActionStatus, MoneyActionOwner } from "@/shared/money-actions/types";
import { recentActionsQuery } from "./recent-actions-query";

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

export function useMoneyActionOutcome({ action, submission, fetchOperations }: {
  action: PreparedMoneyAction;
  submission: Submission;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
}): { outcome: MoneyResultStatus; row?: ResultRow } {
  const session = {
    user: { subject: action.owner.subject },
    smartAccount: { address: action.owner.address, chainId: action.owner.chainId },
    accountProvider: action.owner.accountProvider,
  };
  const ownerKey = dataOwnerKey(session);
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const observationKey = ownerQueryKey(ownerKey, "action-result-observation", action.id);
  const observation = useHomeQuery<ResultRow>({
    queryKey: observationKey,
    queryFn: skipToken,
    enabled: false,
    meta: ownerQueryMeta(ownerKey, "memory"),
  });
  const actions = useHomeQuery({
    ...recentActionsQuery({ owner: ownerKey, session, fetchOperations }),
    enabled: submission !== "failed",
    refetchInterval: (query) => {
      const operation = query.state.data?.operations.find((candidate) => candidate.action.id === action.id) ??
        query.state.data?.retainedSavingsDeposits.find((candidate) => candidate.action.id === action.id);
      const outcome = moneyResultOutcome({ submission, row: operation ?? queryClient.getQueryData<ResultRow>(observationKey) });
      return outcome === "pending" || outcome === "unknown" ? 5_000 : false;
    },
  });
  const operation = actions.data?.operations.find((candidate) => candidate.action.id === action.id) ??
    actions.data?.retainedSavingsDeposits.find((candidate) => candidate.action.id === action.id);
  useEffect(() => {
    if (operation && submission !== "failed") {
      queryClient.setQueryData(ownerQueryKey(ownerKey, "action-result-observation", action.id),
        { id: operation.action.id, status: operation.status, owner: action.owner });
    }
  }, [operation, submission, queryClient, ownerKey, action.id, action.owner]);
  const row = operation ? { id: operation.action.id, status: operation.status, owner: action.owner } : observation.data;
  return { outcome: moneyResultOutcome({ submission, row }), ...(row ? { row } : {}) };
}
