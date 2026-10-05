import "server-only";

import { serverEnvironment } from "@/server/config/env";

import { createPublicClient, http, type TransactionReceipt } from "viem";
import { base } from "viem/chains";
import { resolveBaseRpcUrl } from "@/server/chain/rpc";
import { emitServerEvent } from "@/server/observability/log";
import { createProviderContext } from "@/server/funding/core/provider-context";
import { UNKNOWN_WINDOW_MS } from "@/server/funding/cash-out-window";
import { getFundingProvider } from "@/server/funding/providers";
import type { FundingProvider, OfframpContext, OfframpOrder } from "@/shared/funding/provider-contract";
import type { CashoutMoneyActionMetadata, MoneyActionOwner } from "@/shared/money-actions/types";
import { actionOwnerKey, type ActionRow, type ActionsStore, type CashoutOrderRow } from "@/server/actions/store";
import type { ActionReceiptState } from "@/server/actions/status";

export type CashoutReceiptRow = { row: ActionRow; receipt: ActionReceiptState | null };
export type RefreshedCashoutOrder = CashoutOrderRow & { progressConfirmed: boolean };

type ProgressStore = Pick<ActionsStore, "ensureCashoutOrder" | "cashoutOrders" | "claimCashoutRefresh" | "linkCashoutDeposit" | "updateCashoutProgress"> &
  Partial<Pick<ActionsStore, "linkedCashoutDepositIds">>;

export async function refreshCashoutProgress(input: {
  owner: MoneyActionOwner;
  rows: readonly CashoutReceiptRow[];
  store: ProgressStore;
  signal: AbortSignal;
  readTransactionReceipt?: (hash: `0x${string}`, signal: AbortSignal) => Promise<Pick<TransactionReceipt, "logs">>;
  providerForId?: (id: string) => FundingProvider | undefined;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}): Promise<RefreshedCashoutOrder[]> {
  const { owner, rows, store, signal, now = () => new Date() } = input;
  const deposits = rows.filter(({ row }) => row.kind === "cash-out" && row.owner_key === actionOwnerKey(owner));
  if (deposits.length === 0) return [];
  const observe = (code: string) => emitServerEvent("action-reconcile", {
    route: "/api/actions", code, outcome: "unavailable", provider: "peer", owner,
  });
  for (const { row } of deposits) {
    try {
      await store.ensureCashoutOrder(owner, row);
    } catch {
      observe("CASHOUT_ENSURE_UNAVAILABLE");
    }
  }
  let records: CashoutOrderRow[];
  try {
    records = await store.cashoutOrders(owner, deposits.map(({ row }) => row.id));
  } catch {
    observe("CASHOUT_READ_UNAVAILABLE");
    return [];
  }
  const byAction = new Map(records.map((record) => [record.action_id, record]));
  const confirmed = new Set<string>();
  const updateProgress = async (actionId: string, update: Parameters<ProgressStore["updateCashoutProgress"]>[2], observedAt: string | null = null, expectedProviderUpdatedAt: string | null = null, expectedDepositId: string | null = null, expectedUpdatedAt: string | null = null) => {
    const updated = await store.updateCashoutProgress(owner, actionId, update, observedAt, expectedProviderUpdatedAt, expectedDepositId, expectedUpdatedAt);
    if (updated) {
      confirmed.add(actionId);
      return updated;
    }
    confirmed.delete(actionId);
    return (await store.cashoutOrders(owner, [actionId]))[0] ?? null;
  };
  const withdrawals = rows.filter(({ row }) => row.kind === "cash-out-withdraw" && row.outcome === "succeeded" && row.owner_key === actionOwnerKey(owner));
  const pendingWithdrawals = rows.filter(({ row }) => unresolvedCashoutWithdrawal(row, actionOwnerKey(owner), now()));
  const orderedDeposits = [...deposits].sort((left, right) => {
    const firstRecord = byAction.get(left.row.id);
    const secondRecord = byAction.get(right.row.id);
    const first = firstRecord && !firstRecord.settled_at ? firstRecord : null;
    const second = secondRecord && !secondRecord.settled_at ? secondRecord : null;
    if (!first || !second) return Number(!!second) - Number(!!first);
    const firstProven = !first.deposit_id && !!left.row.transaction_hash && left.row.outcome === "succeeded";
    const secondProven = !second.deposit_id && !!right.row.transaction_hash && right.row.outcome === "succeeded";
    if (firstProven !== secondProven && (!left.row.transaction_hash || !right.row.transaction_hash)) {
      return Number(secondProven) - Number(firstProven);
    }
    const firstRefresh = first.refreshed_at === null ? -Infinity : new Date(first.refreshed_at).getTime();
    const secondRefresh = second.refreshed_at === null ? -Infinity : new Date(second.refreshed_at).getTime();
    if (firstRefresh !== secondRefresh) return firstRefresh - secondRefresh;
    return new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
  });
  let providerReads = 0;
  let refreshed = 0;
  for (const { row, receipt: observedReceipt } of orderedDeposits) {
    const receipt = receiptProof(row, observedReceipt);
    let record = byAction.get(row.id);
    if (!record || record.settled_at || signal.aborted) continue;
    let claimed = false;
    const withinBudget = () => claimed || refreshed < 2;
    const claim = async () => {
      if (claimed) return;
      claimed = true;
      refreshed += 1;
      await store.claimCashoutRefresh(owner, row.id);
    };
    try {
      const metadata = row.summary.metadata;
      if (metadata?.product !== "cashout" || metadata.operation !== "deposit") continue;
      let effectivePayeeHash = metadata.payeeHash;
      if (row.outcome === "not_submitted" && !record.deposit_proven) {
        record = await updateProgress(row.id, {
          state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
          remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
        }, null, providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
        continue;
      }
      const provider = input.providerForId ? input.providerForId(record.provider_id) : getFundingProvider(record.provider_id);
      if (!provider?.offramp) throw new Error("Cash-out provider unavailable.");
      const offramp = provider.offramp;
      const ensurePayeeHash = async (ctx: OfframpContext): Promise<boolean> => {
        if (effectivePayeeHash) return true;
        if (providerReads >= 2 || !withinBudget()) return false;
        await claim();
        providerReads += 1;
        try {
          effectivePayeeHash = await untilAborted(offramp.payeeHash({
            platform: metadata.platform, currency: metadata.currency, canonicalHandle: metadata.canonicalHandle,
          }, ctx), signal);
          return true;
        } catch {
          observe("CASHOUT_PAYEE_UNAVAILABLE");
          return false;
        }
      };
      if (record.deposit_id) {
        const depositId = record.deposit_id;
        const withdraw = withdrawals.find(({ row: next }) => next.transaction_hash && next.summary.metadata?.product === "cashout" &&
          next.summary.metadata.operation === "withdraw" && next.summary.metadata.depositId.toLowerCase() === depositId.toLowerCase());
        if (withdraw && providerReads < 2 && withinBudget()) {
          let returned: bigint | null = null;
          await claim();
          try {
            const tx = await untilAborted((input.readTransactionReceipt ?? readTransactionReceipt)(withdraw.row.transaction_hash as `0x${string}`, signal), signal);
            if (signal.aborted) break;
            const amount = provider.offramp.withdrawnAmountFromReceipt(
              { logs: tx.logs.map(({ address, topics, data }) => ({ address, topics, data })) },
              { owner: owner.address, depositId },
            );
            if (amount === null) observe("CASHOUT_WITHDRAW_MISMATCH");
            else returned = BigInt(amount);
          } catch {
            observe("CASHOUT_WITHDRAW_RECEIPT_UNAVAILABLE");
            if (signal.aborted) break;
          }
          if (returned !== null) {
            const settled = returned > BigInt(0) && BigInt(record.filled_atomic) + returned === BigInt(record.amount_atomic);
            record = await updateProgress(row.id, {
              state: settled ? "returned" : record.state, filledAtomic: record.filled_atomic,
              returnedAtomic: returned > BigInt(0) ? returned.toString() : record.returned_atomic,
              remainingAtomic: settled ? "0" : record.remaining_atomic, withdrawable: false, settled,
            }, null, providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
          }
        }
      }
      if (!record.settled_at) {
        let verifiedOrder: OfframpOrder | undefined;
        let unproven = receipt === "failed" || receipt === "unavailable" || receipt === "unattributed";
        if (!record.deposit_id && receipt === "confirmed" && row.transaction_hash && providerReads < 2 && withinBudget()) {
          await claim();
          let depositId: string | null = null;
          try {
            const tx = await untilAborted((input.readTransactionReceipt ?? readTransactionReceipt)(row.transaction_hash as `0x${string}`, signal), signal);
            if (signal.aborted) break;
            depositId = provider.offramp.depositIdFromReceipt({ logs: tx.logs.map(({ address, topics, data }) => ({ address, topics, data })) },
              { owner: owner.address, escrow: metadata.escrow, amountAtomic: record.amount_atomic, intentAmountRange: metadata.intentAmountRange });
          } catch {
            observe("CASHOUT_DEPOSIT_RECEIPT_UNAVAILABLE");
            if (signal.aborted) break;
          }
          if (!depositId) unproven = true;
          if (depositId) {
            const ctx = recoveryContext(provider, record, input.env);
            providerReads += 1;
            const order = await untilAborted(provider.offramp.readOrder({ owner: owner.address, depositId }, ctx), signal);
            if (signal.aborted) break;
            if (matchesAction(order, record, metadata, metadata.payeeHash)) {
              if (row.outcome !== "succeeded") {
                record = await updateProgress(row.id, {
                  state: order.state, filledAtomic: order.filledAmountAtomic, returnedAtomic: order.returnedAmountAtomic,
                  remainingAtomic: order.remainingAmountAtomic, withdrawable: false, settled: false,
                }, orderObservationTime(order), providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
                continue;
              }
              const linked = await store.linkCashoutDeposit(owner, row.id, depositId, true);
              if (linked) {
                record = linked;
              } else {
                const current = (await store.cashoutOrders(owner, [row.id]))[0];
                if (current) {
                  record = current;
                  if (!record.deposit_id && !record.settled_at) {
                    record = await updateProgress(row.id, {
                      state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
                      remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
                    }, null, providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
                  }
                }
              }
              if (record.deposit_id?.toLowerCase() === depositId.toLowerCase()) verifiedOrder = order;
              for (const current of await store.cashoutOrders(owner, deposits.map(({ row: deposit }) => deposit.id))) {
                byAction.set(current.action_id, current);
              }
            } else {
              observe("CASHOUT_LINK_MISMATCH");
              unproven = true;
            }
          }
        }
        if (!record.deposit_id && (row.outcome === "succeeded" || receipt !== "confirmed" || !row.transaction_hash) &&
          (!row.transaction_hash || unproven) && providerReads < 2 && withinBudget()) {
          const ctx = recoveryContext(provider, record, input.env);
          if (!effectivePayeeHash && providerReads > 0) continue;
          if (!(await ensurePayeeHash(ctx)) || !effectivePayeeHash) continue;
          const payeeHash = effectivePayeeHash;
          if (providerReads >= 2 || signal.aborted) continue;
          await claim();
          providerReads += 1;
          const orders = await untilAborted(provider.offramp.listOrders({ owner: owner.address, inFlight: false, onMalformedPayee: "skip" }, ctx), signal);
          if (signal.aborted) break;
          if (!store.linkedCashoutDepositIds) throw new Error("Cash-out deposit lookup unavailable.");
          const linked = new Set(await store.linkedCashoutDepositIds(owner, record.provider_id));
          const unclaimed = orders.filter((order) => matchesOrder(order, record!, metadata) && !linked.has(order.depositId.toLowerCase()));
          const identified = unclaimed.filter((order) => matchesPayee(order, payeeHash));
          const candidates = identified.filter((order) => changedSincePrepare(order, row));
          const undated = identified.some((order) => !(Date.parse(order.updatedAt) > 0));
          if (candidates.length === 1) {
            record = await store.linkCashoutDeposit(owner, row.id, candidates[0]!.depositId, false) ?? record;
            if (record.deposit_id?.toLowerCase() === candidates[0]!.depositId.toLowerCase()) verifiedOrder = candidates[0];
          }
          const abandoned = row.transaction_hash === null && row.provider_handle === null && row.handle_recorded_at === null &&
            row.confirmed_at !== null && now().getTime() - new Date(row.confirmed_at).getTime() > UNKNOWN_WINDOW_MS;
          if (candidates.length === 0 && !undated && (row.outcome === "reverted" || abandoned)) {
            record = await updateProgress(row.id, {
              state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
              remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
            }, null, providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
          }
        }
        if (record.deposit_id && (verifiedOrder || (providerReads < 2 && withinBudget()))) {
          const currentDepositId = record.deposit_id;
          let order = verifiedOrder;
          if (!order) {
            const ctx = recoveryContext(provider, record, input.env);
            await claim();
            providerReads += 1;
            order = await untilAborted(provider.offramp.readOrder({ owner: owner.address, depositId: record.deposit_id }, ctx), signal);
          }
          if (signal.aborted) break;
          record = await updateProgress(row.id, {
            state: order.state, filledAtomic: order.filledAmountAtomic, returnedAtomic: order.returnedAmountAtomic,
            remainingAtomic: order.remainingAmountAtomic, withdrawable: order.nextActions.includes("withdraw"),
            settled: order.state === "delivered" || (order.state === "returned" && !pendingWithdrawals.some(({ row: withdraw }) =>
              withdraw.summary.metadata?.product === "cashout" && withdraw.summary.metadata.operation === "withdraw" &&
              withdraw.summary.metadata.depositId.toLowerCase() === currentDepositId.toLowerCase())),
          }, orderObservationTime(order), providerWatermark(record), record.deposit_id, rowRevision(record)) ?? record;
        }
      }
    } catch {
      observe("CASHOUT_REFRESH_UNAVAILABLE");
    } finally {
      byAction.set(row.id, record);
    }
  }
  return [...byAction.values()].map((record) => ({ ...record, progressConfirmed: confirmed.has(record.action_id) }));
}

type CashoutRead<T> = { status: "available"; value: T } | { status: "unavailable" };
type CashoutRefreshContext = {
  now?: Date;
  providerReads?: number;
  refreshed?: number;
  claimed?: boolean;
  aborted?: boolean;
  depositProof?: CashoutRead<string | null>;
  payeeHash?: CashoutRead<`0x${string}`>;
  order?: CashoutRead<OfframpOrder>;
  verifiedOrder?: OfframpOrder;
  orders?: CashoutRead<readonly OfframpOrder[]>;
  linkedDepositIds?: CashoutRead<readonly string[]>;
  link?: CashoutRead<CashoutOrderRow | null>;
  withdrawal?: CashoutRead<string | null>;
  withdrawalApplied?: boolean;
};
type CashoutProgressUpdate = Parameters<ProgressStore["updateCashoutProgress"]>[2];
type CashoutRefreshStep =
  | { kind: "ensure-order"; actionId: string }
  | { kind: "prove-deposit" | "read-withdraw-receipt"; transactionHash: string }
  | { kind: "read-order"; depositId: string }
  | { kind: "read-payee-hash" | "read-orders" | "read-linked-deposits" | "read-record" }
  | { kind: "link-deposit"; depositId: string; proven: boolean }
  | { kind: "update-order" | "update-returned" | "settle-failed" | "settle-delivered" | "settle-returned"; update: CashoutProgressUpdate };
type CashoutRefreshPlan =
  | { kind: "current"; steps: []; reason: "settled" | "no-actionable-data" | "budget" | "aborted" }
  | { kind: "missing"; steps: [{ kind: "ensure-order"; actionId: string }] }
  | { kind: "partial"; steps: CashoutRefreshStep[]; reason?: "unavailable" | "time-required" }
  | { kind: "terminal"; steps: CashoutRefreshStep[] };

/** @public The #1208 follow-up consumes this pure cash-out refresh planner. */
export function planCashoutRefresh(record: CashoutOrderRow | null | undefined, rows: readonly CashoutReceiptRow[], context: CashoutRefreshContext = {}): CashoutRefreshPlan {
  const current = (reason: Extract<CashoutRefreshPlan, { kind: "current" }>["reason"]): CashoutRefreshPlan => ({ kind: "current", steps: [], reason });
  const partial = (step: CashoutRefreshStep): CashoutRefreshPlan => ({ kind: "partial", steps: [step] });
  const unavailable = (): CashoutRefreshPlan => ({ kind: "partial", steps: [], reason: "unavailable" });
  if (record?.settled_at) return current("settled");
  if (context.aborted) return current("aborted");
  const deposit = rows.find(({ row }) => row.kind === "cash-out" && (!record || row.id === record.action_id && row.owner_key === record.owner_key));
  if (!deposit) return current("no-actionable-data");
  const { row, receipt: observedReceipt } = deposit;
  const metadata = row.summary.metadata;
  if (metadata?.product !== "cashout" || metadata.operation !== "deposit") return current("no-actionable-data");
  if (!record) return row.confirmed_at ? { kind: "missing", steps: [{ kind: "ensure-order", actionId: row.id }] } : current("no-actionable-data");
  const failed = (target = record): CashoutRefreshPlan => ({ kind: "terminal", steps: [{ kind: "settle-failed", update: {
    state: "failed", filledAtomic: target.filled_atomic, returnedAtomic: target.returned_atomic,
    remainingAtomic: target.remaining_atomic, withdrawable: false, settled: true,
  } }] });
  if (row.outcome === "not_submitted" && !record.deposit_proven) return failed();
  let providerReads = context.providerReads ?? 0;
  let claimed = context.claimed ?? false;
  const canRead = () => providerReads < 2 && (claimed || (context.refreshed ?? 0) < 2);
  const receipt = receiptProof(row, observedReceipt);
  const sameDeposit = (next: ActionRow, depositId: string) => next.owner_key === record.owner_key && next.kind === "cash-out-withdraw" &&
    next.summary.metadata?.product === "cashout" && next.summary.metadata.operation === "withdraw" &&
    next.summary.metadata.depositId.toLowerCase() === depositId.toLowerCase();
  const applyOrder = (order: OfframpOrder, linked: boolean): CashoutRefreshPlan => {
    const withdrawals = rows.filter(({ row: next }) => sameDeposit(next, order.depositId) && !next.outcome);
    if (linked && order.state === "returned" && !context.now && withdrawals.some(({ row: next }) =>
      !next.transaction_hash && !next.provider_handle && !next.handle_recorded_at && next.confirmed_at && !next.declined_reported_at)) {
      return { kind: "partial", steps: [], reason: "time-required" };
    }
    const pendingWithdrawal = withdrawals.some(({ row: next }) => context.now
      ? unresolvedCashoutWithdrawal(next, record.owner_key, context.now)
      : !!(next.transaction_hash || next.provider_handle || next.handle_recorded_at));
    const settled = linked && (order.state === "delivered" || order.state === "returned" && !pendingWithdrawal);
    const update: CashoutProgressUpdate = { state: order.state, filledAtomic: order.filledAmountAtomic,
      returnedAtomic: order.returnedAmountAtomic, remainingAtomic: order.remainingAmountAtomic,
      withdrawable: linked && order.nextActions.includes("withdraw"), settled };
    return { kind: settled ? "terminal" : "partial", steps: [{ kind: settled
      ? order.state === "delivered" ? "settle-delivered" : "settle-returned" : "update-order", update }] };
  };
  const recordDepositId = record.deposit_id;
  if (recordDepositId) {
    const withdraw = rows.find(({ row: next }) => sameDeposit(next, recordDepositId) && next.outcome === "succeeded" && next.transaction_hash);
    if (withdraw && canRead()) {
      const transactionHash = withdraw.row.transaction_hash;
      if (!transactionHash) return current("no-actionable-data");
      claimed = true;
      if (!context.withdrawal) return partial({ kind: "read-withdraw-receipt", transactionHash });
      if (context.withdrawal.status === "available" && context.withdrawal.value !== null && !context.withdrawalApplied) {
        const returned = BigInt(context.withdrawal.value);
        const settled = returned > BigInt(0) && BigInt(record.filled_atomic) + returned === BigInt(record.amount_atomic);
        return { kind: settled ? "terminal" : "partial", steps: [{ kind: settled ? "settle-returned" : "update-returned", update: {
          state: settled ? "returned" : record.state, filledAtomic: record.filled_atomic,
          returnedAtomic: returned > BigInt(0) ? returned.toString() : record.returned_atomic,
          remainingAtomic: settled ? "0" : record.remaining_atomic, withdrawable: false, settled,
        } }] };
      }
    }
    if (context.verifiedOrder) return applyOrder(context.verifiedOrder, true);
    if (!canRead()) return current("budget");
    if (!context.order) return partial({ kind: "read-order", depositId: recordDepositId });
    return context.order.status === "available" ? applyOrder(context.order.value, true) : unavailable();
  }
  let unproven = receipt === "failed" || receipt === "unavailable" || receipt === "unattributed";
  if (receipt === "confirmed" && row.transaction_hash && canRead()) {
    claimed = true;
    if (!context.depositProof) return partial({ kind: "prove-deposit", transactionHash: row.transaction_hash });
    const depositId = context.depositProof.status === "available" ? context.depositProof.value : null;
    if (!depositId) unproven = true;
    else {
      if (!context.order) return partial({ kind: "read-order", depositId });
      providerReads += 1;
      if (context.order.status === "unavailable") return unavailable();
      const order = context.order.value;
      if (matchesAction(order, record, metadata, metadata.payeeHash)) {
        if (row.outcome !== "succeeded") return applyOrder(order, false);
        if (!context.link) return partial({ kind: "link-deposit", depositId, proven: true });
        if (context.link.status === "unavailable") return unavailable();
        if (!context.link.value) return partial({ kind: "read-record" });
        if (!context.link.value.deposit_id && !context.link.value.settled_at) return failed(context.link.value);
        if (context.link.value.settled_at) return current("settled");
        const linkedDepositId = context.link.value.deposit_id;
        if (linkedDepositId?.toLowerCase() === depositId.toLowerCase()) return applyOrder(order, true);
        return linkedDepositId && canRead() ? partial({ kind: "read-order", depositId: linkedDepositId }) : current("budget");
      }
      unproven = true;
    }
  }
  if ((row.outcome === "succeeded" || receipt !== "confirmed" || !row.transaction_hash) && (!row.transaction_hash || unproven) && canRead()) {
    let payeeHash = metadata.payeeHash;
    if (!payeeHash) {
      if (providerReads > 0) return current("budget");
      claimed = true;
      if (!context.payeeHash) return partial({ kind: "read-payee-hash" });
      providerReads += 1;
      if (context.payeeHash.status === "unavailable") return unavailable();
      payeeHash = context.payeeHash.value;
    }
    if (!canRead()) return current("budget");
    if (!context.orders) return partial({ kind: "read-orders" });
    if (context.orders.status === "unavailable") return unavailable();
    if (!context.linkedDepositIds) return partial({ kind: "read-linked-deposits" });
    if (context.linkedDepositIds.status === "unavailable") return unavailable();
    const linked = new Set(context.linkedDepositIds.value);
    const identified = context.orders.value.filter((order) => matchesOrder(order, record, metadata) &&
      !linked.has(order.depositId.toLowerCase()) && matchesPayee(order, payeeHash));
    const candidates = identified.filter((order) => changedSincePrepare(order, row));
    const undated = identified.some((order) => !(Date.parse(order.updatedAt) > 0));
    if (candidates.length === 1) {
      const [order] = candidates;
      if (!order) return current("no-actionable-data");
      if (!context.link) return partial({ kind: "link-deposit", depositId: order.depositId, proven: false });
      if (context.link.status === "unavailable") return unavailable();
      if (context.link.value?.settled_at) return current("settled");
      if (context.link.value?.deposit_id?.toLowerCase() === order.depositId.toLowerCase()) return applyOrder(order, true);
      providerReads += 1;
      return context.link.value?.deposit_id && canRead()
        ? partial({ kind: "read-order", depositId: context.link.value.deposit_id }) : current("no-actionable-data");
    }
    const hashless = row.transaction_hash === null && row.provider_handle === null && row.handle_recorded_at === null && row.confirmed_at !== null;
    const confirmedAt = row.confirmed_at;
    const abandoned = hashless && confirmedAt !== null && context.now !== undefined && context.now.getTime() - new Date(confirmedAt).getTime() > UNKNOWN_WINDOW_MS;
    if (candidates.length === 0 && !undated && (row.outcome === "reverted" || abandoned)) return failed();
    if (candidates.length === 0 && !undated && hashless && !context.now) return { kind: "partial", steps: [], reason: "time-required" };
    return current("no-actionable-data");
  }
  return current(canRead() ? "no-actionable-data" : "budget");
}

export function cashoutWithdrawalInFlight(rows: readonly CashoutReceiptRow[], owner: MoneyActionOwner, depositId: string, now: Date): boolean {
  return rows.some(({ row }) => unresolvedCashoutWithdrawal(row, actionOwnerKey(owner), now) &&
    row.summary.metadata?.product === "cashout" && row.summary.metadata.operation === "withdraw" &&
    row.summary.metadata.depositId.toLowerCase() === depositId.toLowerCase());
}

function unresolvedCashoutWithdrawal(row: ActionRow, ownerKey: string, at: Date): boolean {
  return row.kind === "cash-out-withdraw" && row.owner_key === ownerKey && !row.outcome &&
    row.summary.metadata?.product === "cashout" && row.summary.metadata.operation === "withdraw" && dispatchUnresolved(row, at);
}

function dispatchUnresolved(row: ActionRow, at: Date): boolean {
  if (row.transaction_hash || row.provider_handle || row.handle_recorded_at) return true;
  return row.confirmed_at !== null && row.declined_reported_at === null &&
    at.getTime() - new Date(row.confirmed_at).getTime() < UNKNOWN_WINDOW_MS;
}

function receiptProof(row: ActionRow, receipt: ActionReceiptState | null): ActionReceiptState | null {
  if (row.outcome) return row.outcome === "succeeded" ? "confirmed" : "failed";
  return receipt;
}

function rowRevision(record: CashoutOrderRow): string {
  const value = record.updated_at;
  return value instanceof Date ? value.toISOString() : value;
}

function providerWatermark(record: CashoutOrderRow): string | null {
  const value = record.provider_updated_at;
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function orderObservationTime(order: OfframpOrder): string | null {
  const parsed = Date.parse(order.updatedAt);
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : null;
}

function matchesAction(order: OfframpOrder, record: CashoutOrderRow, metadata: CashoutMoneyActionMetadata, payeeHash: `0x${string}` | undefined): boolean {
  return matchesOrder(order, record, metadata) && (!payeeHash || matchesPayee(order, payeeHash));
}

function matchesOrder(order: OfframpOrder, record: CashoutOrderRow, metadata: CashoutMoneyActionMetadata): boolean {
  return order.amountAtomic === record.amount_atomic && order.platform === record.platform &&
    order.currency.toUpperCase() === metadata.currency.toUpperCase();
}

function matchesPayee(order: OfframpOrder, payeeHash: `0x${string}`): boolean {
  return order.payeeHash.toLowerCase() === payeeHash.toLowerCase();
}

async function untilAborted<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    read.catch(() => {}); // oxlint-disable-line home/no-silent-catch -- the already-aborted refresh throws the deadline reason; the detached read must not reject unhandled
    throw signal.reason ?? new Error("Cash-out refresh deadline passed.");
  }
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Cash-out refresh deadline passed."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([read, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function changedSincePrepare(order: OfframpOrder, row: ActionRow): boolean {
  const preparedAtSecond = Math.floor(new Date(row.created_at).getTime() / 1000) * 1000;
  const changedAt = Date.parse(order.updatedAt);
  return Number.isFinite(preparedAtSecond) && changedAt > 0 && changedAt >= preparedAtSecond;
}

function recoveryContext(provider: FundingProvider, record: CashoutOrderRow, env?: Readonly<Record<string, string | undefined>>): OfframpContext {
  const binding = provider.manifest.bindings.find((candidate) => candidate.region === record.region && candidate.directions.offramp);
  const methods = binding?.directions.offramp?.paymentMethods;
  const method = methods?.find((candidate) => candidate.id === record.platform) ?? methods?.[0];
  if (!binding || !method) throw new Error("Cash-out binding unavailable.");
  const escrow = record.deposit_id?.split("_")[0]?.toLowerCase();
  const sandbox = escrow
    ? provider.manifest.offramp?.sandbox?.contracts.escrow.toLowerCase() === escrow
    : record.environment === "sandbox";
  const deployment = sandbox ? provider.manifest.offramp?.sandbox : provider.manifest.offramp?.production;
  if (!deployment || (escrow && deployment.contracts.escrow.toLowerCase() !== escrow)) throw new Error("Cash-out deployment unavailable.");
  return createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "offramp", paymentMethodId: method.id, env: env ?? serverEnvironment(), sandbox });
}

async function readTransactionReceipt(hash: `0x${string}`, signal: AbortSignal): Promise<Pick<TransactionReceipt, "logs">> {
  if (signal.aborted) throw signal.reason;
  return await createPublicClient({ chain: base, transport: http(resolveBaseRpcUrl(), { timeout: 3_000 }) }).getTransactionReceipt({ hash });
}
