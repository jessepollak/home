"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { cashoutProgress, linkedCashoutWithdraw } from "@/client/activity/cash-out-presenter";
import { fetchRecentActions, recentActionsQueryOptions, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { isRecentActionsResponse, parseRecentMoneyActions, readRecentActionsIncomplete, readRecentActionsTruncated, type RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";

const EMPTY_OPERATIONS: RecentMoneyActionOperation[] = [];
const UNREADABLE_ESTIMATE = { state: "unreadable" } as const;
const INDETERMINATE_ESTIMATE = { state: "indeterminate" } as const;
const LOADING_ESTIMATE = { state: "loading" } as const;

function useSelectActions(session: VerifiedAccountSession | null) {
  return useCallback((value: unknown) => session?.smartAccount
    ? { operations: parseRecentMoneyActions(value, session), truncated: readRecentActionsTruncated(value), incomplete: readRecentActionsIncomplete(value, session) }
    : { operations: EMPTY_OPERATIONS, truncated: false, incomplete: false }, [session]);
}

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
  const selectActions = useSelectActions(session);
  const snapshotKey = ownerKey && snapshot && snapshot.owner.address.toLowerCase() === session?.smartAccount?.address.toLowerCase() &&
    snapshot.owner.chainId === session.smartAccount.chainId
    ? `${ownerKey}:${snapshot.fetchedAt}:${snapshot.block.number}` : null;
  const ownRead = useRef<{ key: string | null; done: boolean } | null>(null);
  const attemptedKey = useRef<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [confirmedSnapshotKey, setConfirmedSnapshotKey] = useState<string | null>(null);
  const query = useHomeQuery({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "actions") : ["unauthenticated", "pending-cashout-disabled"],
    enabled: ownerKey !== null,
    ...recentActionsQueryOptions,
    refetchInterval: (state) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible" || !session?.smartAccount ||
        !isRecentActionsResponse(state.state.data)) return false;
      const operations = parseRecentMoneyActions(state.state.data, session);
      return operations.some((operation) => operation.action.kind === "cash-out" &&
        cashoutProgress(operation, linkedCashoutWithdraw(operation, operations)).refreshing) ? 15_000 : false;
    },
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    queryFn: ({ signal }) => {
      const read = { key: snapshotKey, done: false };
      ownRead.current = read;
      return fetchRecentActions(fetchOperations, signal).then(
        (value) => {
          if (ownRead.current === read && !signal.aborted) {
            read.done = true;
            setConfirmedSnapshotKey(read.key);
            if (read.key !== null) setFailedKey((key) => key === read.key ? null : key);
          }
          return value;
        },
        (error: unknown) => {
          if (ownRead.current === read) ownRead.current = null;
          throw error;
        },
      );
    },
    select: selectActions,
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
