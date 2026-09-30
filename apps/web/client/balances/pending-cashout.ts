"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { cashoutProgress, linkedCashoutWithdraw } from "@/client/activity/cash-out-presenter";
import { refetchFailedRecentActions, retryRecentActions, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { useHomeQuery } from "@/client/query/query-client";
import { ownerQuery } from "@/client/query/query-options";
import { parseRecentMoneyActions, readRecentActionsIncomplete, readRecentActionsTruncated, type RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";

const UNREADABLE_ESTIMATE = { state: "unreadable" } as const;
const INDETERMINATE_ESTIMATE = { state: "indeterminate" } as const;
const LOADING_ESTIMATE = { state: "loading" } as const;


export function selectPendingCashoutEscrow(operations: readonly RecentMoneyActionOperation[], snapshot: BalancesSnapshot): PendingCashoutEstimate {
  let remaining = BigInt(0);
  let indeterminate = false;
  for (const operation of operations) {
    if (operation.action.kind !== "cash-out") continue;
    const withdraw = linkedCashoutWithdraw(operation, operations);
    const cashout = operation.cashout;
    const presentation = cashoutProgress(operation, withdraw);
    if (!presentation.inProgress) {
      if (!cashout) indeterminate = true;
      continue;
    }
    if (!cashout?.depositId || !cashout.depositBlockNumber || !/^\d+$/.test(cashout.depositBlockNumber) ||
      !/^\d+$/.test(cashout.remainingAtomic)) {
      indeterminate = true;
      continue;
    }
    if (BigInt(cashout.depositBlockNumber) > BigInt(snapshot.block.number)) continue;
    if (cashout.progressConfirmed !== true || withdraw && withdraw.status !== "failed") {
      indeterminate = true;
      continue;
    }
    remaining += BigInt(cashout.remainingAtomic);
  }
  return remaining > BigInt(0) ? { state: "escrow", baseUnits: remaining.toString(), partial: indeterminate }
    : indeterminate ? { state: "indeterminate" } : null;
}

export function usePendingCashoutEscrow(
  session: VerifiedAccountSession | null,
  snapshot: BalancesSnapshot | null,
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>,
): PendingCashoutEstimate {
  const ownerKey = session?.smartAccount ? dataOwnerKey(session) : null;
  const snapshotKey = ownerKey && snapshot && snapshot.owner.address.toLowerCase() === session?.smartAccount?.address.toLowerCase() &&
    snapshot.owner.chainId === session.smartAccount.chainId
    ? `${ownerKey}:${snapshot.fetchedAt}:${snapshot.block.number}` : null;
  const ownRead = useRef<{ key: string | null; done: boolean } | null>(null);
  const attemptedKey = useRef<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [confirmedSnapshotKey, setConfirmedSnapshotKey] = useState<string | null>(null);
  const queryOptions = ownerQuery<{
    operations: RecentMoneyActionOperation[];
    truncated: boolean;
    incomplete: boolean;
  }>({
    owner: ownerKey,
    scope: "actions",
    key: ["pending-cashout"],
    retry: retryRecentActions,
    retryDelay: (attempt) => Math.min(500 * 3 ** attempt, 1_500),
    refetchOnWindowFocus: refetchFailedRecentActions,
    refetchOnReconnect: refetchFailedRecentActions,
    queryFn: async ({ signal }) => {
      if (!session) throw new Error("Actions are unavailable.");
      const value = await fetchOperations(signal);
      return {
        operations: parseRecentMoneyActions(value, session),
        truncated: readRecentActionsTruncated(value),
        incomplete: readRecentActionsIncomplete(value, session),
      };
    },
    refetchInterval: (state) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !session?.smartAccount) return false;
      const operations = state.state.data?.operations;
      return operations?.some((operation) => operation.action.kind === "cash-out" &&
        cashoutProgress(operation, linkedCashoutWithdraw(operation, operations)).refreshing) ? 15_000 : false;
    },
  });
  const readActions = queryOptions.queryFn;
  const query = useHomeQuery({
    ...queryOptions,
    queryFn: typeof readActions === "function" ? async (context) => {
      const read = { key: snapshotKey, done: false };
      ownRead.current = read;
      try {
        const parsed = await readActions(context);
        if (ownRead.current === read && !context.signal.aborted) {
          read.done = true;
          setConfirmedSnapshotKey(read.key);
          if (read.key !== null) setFailedKey((key) => key === read.key ? null : key);
        }
        return parsed;
      } catch (error) {
        if (ownRead.current === read) ownRead.current = null;
        throw error;
      }
    } : readActions,
  });
  const { data, dataUpdatedAt, errorUpdatedAt, isPending, isError, isFetching, refetch } = query;
  const actionsStatus = useRecentActionsStatus({ hasData: data !== undefined, isPending, isError, dataUpdatedAt, errorUpdatedAt });
  useEffect(() => {
    if (!snapshotKey || isFetching || attemptedKey.current === snapshotKey) return;
    const read = ownRead.current;
    if (read?.key === snapshotKey && read.done) return;
    attemptedKey.current = snapshotKey;
    void refetch({ cancelRefetch: false }).then((result) => {
      const completed = ownRead.current;
      if (result.isError || completed?.key !== snapshotKey || !completed.done) setFailedKey(snapshotKey);
      else setFailedKey((key) => key === snapshotKey ? null : key);
    });
  }, [snapshotKey, isFetching, dataUpdatedAt, refetch]);
  const selected = useMemo(() => snapshotKey && snapshot && data?.operations
    ? selectPendingCashoutEscrow(data.operations, snapshot) : null, [snapshotKey, snapshot, data]);
  const selectedState = selected?.state;
  const selectedBaseUnits = selected?.state === "escrow" ? selected.baseUnits : null;
  const selectedPartial = selected?.state === "escrow" ? selected.partial : false;
  const stableEstimate = useMemo(() => selectedState === "escrow" && selectedBaseUnits !== null
    ? { state: "escrow" as const, baseUnits: selectedBaseUnits, partial: selectedPartial }
    : selectedState === "indeterminate" ? INDETERMINATE_ESTIMATE : null, [selectedState, selectedBaseUnits, selectedPartial]);
  if (!ownerKey) return snapshot === null ? null : LOADING_ESTIMATE;
  if (!snapshotKey) return null;
  if (failedKey === snapshotKey || actionsStatus === "error") return UNREADABLE_ESTIMATE;
  if (actionsStatus === "loading") return LOADING_ESTIMATE;
  if (data?.truncated === true || data?.incomplete === true) return UNREADABLE_ESTIMATE;
  if (stableEstimate === null && data !== undefined && confirmedSnapshotKey !== snapshotKey) return LOADING_ESTIMATE;
  return stableEstimate;
}
