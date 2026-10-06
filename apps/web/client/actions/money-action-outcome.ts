"use client";

import { skipToken } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { highestBlockNumber, invalidateAfterAction, requalifyBalancesAfterSettlement } from "@/client/query/after-action";
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

export type MoneyActionQualification = {
  actionId: string;
  settlement: string | null;
  settlementBlock: string | null;
  qualifiedSettlement: string | null;
  qualifiedUnknown: boolean;
  unknownServerAt: number | null;
};

export function createMoneyActionQualification(actionId: string): MoneyActionQualification {
  return { actionId, settlement: null, settlementBlock: null, qualifiedSettlement: null, qualifiedUnknown: false, unknownServerAt: null };
}

export function nextMoneyActionQualification(input: {
  current: MoneyActionQualification;
  actionId: string;
  submission: Submission;
  outcome: MoneyResultStatus;
  settled: boolean;
  operation?: { settledAt?: string; settledBlockNumber?: string; submittedAt?: string; updatedAt?: string };
}): { qualification: MoneyActionQualification; action: "none" | "settlement" | "unknown"; settledBlock?: string } {
  const { actionId, submission, outcome, settled, operation } = input;
  const current = input.current.actionId === actionId ? input.current : createMoneyActionQualification(actionId);
  if (submission === "failed" || outcome === "failed") return { qualification: current, action: "none" };
  if (settled) {
    const block = highestBlockNumber(current.settlementBlock ?? undefined, operation?.settledBlockNumber);
    const settlement = operation
      ? `${actionId}\u0000${block ?? operation.settledAt ?? ""}`
      : (current.settlement ?? `${actionId}\u0000`);
    const qualification = { ...current, settlement, settlementBlock: block ?? null };
    if (settlement === current.qualifiedSettlement) return { qualification, action: "none" };
    return {
      qualification: { ...qualification, qualifiedSettlement: settlement },
      action: "settlement",
      ...(block !== undefined ? { settledBlock: block } : {}),
    };
  }
  if (submission === "ambiguous" && outcome === "unknown") {
    const serverAt = Date.parse(operation?.submittedAt ?? operation?.updatedAt ?? "");
    const newerServerAt = Number.isFinite(serverAt) && serverAt > (current.unknownServerAt ?? 0);
    if (!current.qualifiedUnknown || newerServerAt) {
      return {
        qualification: { ...current, qualifiedUnknown: true, unknownServerAt: newerServerAt ? serverAt : current.unknownServerAt },
        action: "unknown",
      };
    }
  }
  return { qualification: current, action: "none" };
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
  const outcome = moneyResultOutcome({ submission, row });
  const settled = row?.status === "confirmed";
  const qualification = useRef(createMoneyActionQualification(action.id));
  useEffect(() => {
    const next = nextMoneyActionQualification({ current: qualification.current, actionId: action.id, submission, outcome, settled, operation });
    qualification.current = next.qualification;
    if (next.action === "settlement") {
      requalifyBalancesAfterSettlement({ queryClient, dataOwnerKey: ownerKey, actionId: action.id, settledBlock: next.settledBlock, serverAt: operation?.settledAt ?? operation?.submittedAt });
    } else if (next.action === "unknown") {
      void invalidateAfterAction({ queryClient, dataOwnerKey: ownerKey, actionId: action.id, serverAt: operation?.submittedAt ?? operation?.updatedAt });
    }
  }, [action.id, submission, outcome, settled, operation, queryClient, ownerKey]);
  return { outcome, ...(row ? { row } : {}) };
}
