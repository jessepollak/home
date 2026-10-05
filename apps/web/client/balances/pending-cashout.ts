"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { cashoutProgress, linkedCashoutWithdraw } from "@/client/activity/cash-out-presenter";
import { getRecentActionsReadSequence, recentActionsQuery, useRecentActionsStatus } from "@/client/actions/recent-actions-query";
import { browserHomeQueryClient, ownerQueryKey, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import type { RecentMoneyActionOperation } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { BalancesSnapshot } from "@/shared/balances/types";
import type { PendingCashoutEstimate } from "@/shared/balances/pending-cashout";

const UNREADABLE_ESTIMATE = { state: "unreadable" } as const;
const INDETERMINATE_ESTIMATE = { state: "indeterminate" } as const;
const LOADING_ESTIMATE = { state: "loading" } as const;
const RETURN_SNAPSHOT_MAX_ATTEMPTS = 6;
const RETURN_SNAPSHOT_RETRY_MS = 30_000;

function withdrawalUnobserved(withdraw: RecentMoneyActionOperation, snapshot: BalancesSnapshot): boolean {
  return withdraw.status !== "confirmed" || (withdraw.receiptBlockNumber !== undefined
    ? BigInt(withdraw.receiptBlockNumber) > BigInt(snapshot.block.number)
    : withdraw.settledAt === undefined);
}

function returnedOrdersAwaitingSnapshotKeys(operations: readonly RecentMoneyActionOperation[], snapshot: BalancesSnapshot): string[] {
  const keys: string[] = [];
  for (const operation of operations) {
    if (operation.action.kind !== "cash-out") continue;
    const withdraw = linkedCashoutWithdraw(operation, operations);
    if (withdraw && withdraw.status !== "failed" || cashoutProgress(operation, withdraw).stage !== "returned") continue;
    const settledAt = operation.cashout?.settledAt;
    const settledTime = Date.parse(settledAt ?? "");
    if (Number.isFinite(settledTime) && settledTime > Number(snapshot.block.timestamp) * 1000) {
      keys.push(`${operation.action.id}:${settledAt}`);
    }
  }
  return keys;
}

export function selectPendingCashoutEscrow(operations: readonly RecentMoneyActionOperation[], snapshot: BalancesSnapshot): PendingCashoutEstimate {
  let remaining = BigInt(0);
  let indeterminate = false;
  for (const operation of operations) {
    if (operation.action.kind === "cash-out-withdraw" && operation.status !== "failed" && withdrawalUnobserved(operation, snapshot)) {
      indeterminate = true;
    }
  }
  for (const operation of operations) {
    if (operation.action.kind !== "cash-out") continue;
    const withdraw = linkedCashoutWithdraw(operation, operations);
    const cashout = operation.cashout;
    const presentation = cashoutProgress(operation, withdraw);
    if (!presentation.inProgress) {
      if (!cashout || presentation.stage === "returned" && withdraw && withdraw.status !== "failed" &&
        withdrawalUnobserved(withdraw, snapshot)) indeterminate = true;
      if (cashout && presentation.stage === "returned" && (!withdraw || withdraw.status === "failed")) {
        const settledTime = Date.parse(cashout.settledAt ?? "");
        if (!Number.isFinite(settledTime) || settledTime > Number(snapshot.block.timestamp) * 1000) indeterminate = true;
      }
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
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const returnSnapshotAttempts = useRef(new Map<string, { attempts: number; nextAttemptAt: number }>());
  const [returnSnapshotTick, setReturnSnapshotTick] = useState(0);
  const snapshotKey = ownerKey && snapshot && snapshot.owner.address.toLowerCase() === session?.smartAccount?.address.toLowerCase() &&
    snapshot.owner.chainId === session.smartAccount.chainId
    ? `${ownerKey}:${snapshot.fetchedAt}:${snapshot.block.number}` : null;
  const [observedSnapshot, setObservedSnapshot] = useState(() => ({ key: snapshotKey, afterSequence: getRecentActionsReadSequence() }));
  let snapshotBinding = observedSnapshot;
  if (observedSnapshot.key !== snapshotKey) {
    snapshotBinding = { key: snapshotKey, afterSequence: getRecentActionsReadSequence() };
    setObservedSnapshot(snapshotBinding);
  }
  const reconciliation = useRef<{ binding: typeof snapshotBinding; attempted: boolean } | null>(null);
  const [failedRead, setFailedRead] = useState<{ key: string; sequence: number } | null>(null);
  const query = useHomeQuery(recentActionsQuery({ owner: ownerKey, session, fetchOperations }));
  const { data, dataUpdatedAt, errorUpdatedAt, isPending, isError, isFetching, refetch } = query;
  const actionsStatus = useRecentActionsStatus({ hasData: data !== undefined, isPending, isError, dataUpdatedAt, errorUpdatedAt });
  const readSequence = data?.readSequence ?? 0;
  const confirmed = readSequence > snapshotBinding.afterSequence;
  useEffect(() => {
    if (reconciliation.current?.binding !== snapshotBinding) {
      reconciliation.current = { binding: snapshotBinding, attempted: false };
    }
    const read = reconciliation.current;
    if (!snapshotKey || isFetching || confirmed || read.attempted) return;
    read.attempted = true;
    const reconcile = async () => {
      let result = await refetch({ cancelRefetch: false });
      if (!result.isError && result.data && result.data.readSequence <= snapshotBinding.afterSequence &&
        result.data.readSequence > readSequence) {
        result = await refetch({ cancelRefetch: false });
      }
      if (reconciliation.current !== read) return;
      if (result.isError || !result.data || result.data.readSequence <= snapshotBinding.afterSequence) {
        setFailedRead({ key: snapshotKey, sequence: result.data?.readSequence ?? 0 });
      }
    };
    void reconcile();
  }, [snapshotKey, snapshotBinding, isFetching, confirmed, readSequence, refetch]);
  const selected = useMemo(() => snapshotKey && snapshot && data?.operations
    ? selectPendingCashoutEscrow(data.operations, snapshot) : null, [snapshotKey, snapshot, data]);
  const selectedState = selected?.state;
  const selectedBaseUnits = selected?.state === "escrow" ? selected.baseUnits : null;
  const selectedPartial = selected?.state === "escrow" ? selected.partial : false;
  const stableEstimate = useMemo(() => selectedState === "escrow" && selectedBaseUnits !== null
    ? { state: "escrow" as const, baseUnits: selectedBaseUnits, partial: selectedPartial }
    : selectedState === "indeterminate" ? INDETERMINATE_ESTIMATE : null, [selectedState, selectedBaseUnits, selectedPartial]);
  useEffect(() => {
    if (!ownerKey || !snapshotKey || !snapshot || !confirmed || actionsStatus !== "ready" ||
      !data || data.truncated || data.incomplete || !stableEstimate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const awaitingKey of returnedOrdersAwaitingSnapshotKeys(data.operations, snapshot)) {
      const key = `${ownerKey}:${awaitingKey}`;
      const attempt = returnSnapshotAttempts.current.get(key);
      if (attempt && attempt.attempts >= RETURN_SNAPSHOT_MAX_ATTEMPTS) continue;
      const delay = attempt ? Math.max(0, attempt.nextAttemptAt - Date.now()) : 0;
      timers.push(setTimeout(() => {
        returnSnapshotAttempts.current.set(key, {
          attempts: (attempt?.attempts ?? 0) + 1,
          nextAttemptAt: Date.now() + RETURN_SNAPSHOT_RETRY_MS,
        });
        void queryClient.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "balances") }, { cancelRefetch: false });
        setReturnSnapshotTick((tick) => tick + 1);
      }, delay));
    }
    return () => { for (const timer of timers) clearTimeout(timer); };
  }, [ownerKey, snapshotKey, snapshot, confirmed, actionsStatus, data, stableEstimate, queryClient, returnSnapshotTick]);
  if (!ownerKey) return snapshot === null ? null : LOADING_ESTIMATE;
  if (!snapshotKey) return null;
  if ((failedRead?.key === snapshotKey && readSequence <= failedRead.sequence) || actionsStatus === "error" || (isError && !confirmed)) return UNREADABLE_ESTIMATE;
  if (actionsStatus === "loading") return LOADING_ESTIMATE;
  if (data?.truncated === true || data?.incomplete === true) return UNREADABLE_ESTIMATE;
  if (!confirmed) return LOADING_ESTIMATE;
  return stableEstimate;
}
