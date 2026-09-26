import "server-only";

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
}): Promise<CashoutOrderRow[]> {
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
        record = await store.updateCashoutProgress(owner, row.id, {
          state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
          remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
        }) ?? record;
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
            record = await store.updateCashoutProgress(owner, row.id, {
              state: settled ? "returned" : record.state, filledAtomic: record.filled_atomic,
              returnedAtomic: returned > BigInt(0) ? returned.toString() : record.returned_atomic,
              remainingAtomic: settled ? "0" : record.remaining_atomic, withdrawable: false, settled,
            }) ?? record;
          }
        }
      }
      if (!record.settled_at) {
        let verifiedOrder: OfframpOrder | undefined;
        let unproven = receipt === "failed" || receipt === "unavailable";
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
                record = await store.updateCashoutProgress(owner, row.id, {
                  state: order.state, filledAtomic: order.filledAmountAtomic, returnedAtomic: order.returnedAmountAtomic,
                  remainingAtomic: order.remainingAmountAtomic, withdrawable: false, settled: false,
                }) ?? record;
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
                    record = await store.updateCashoutProgress(owner, row.id, {
                      state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
                      remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
                    }) ?? record;
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
            record = await store.updateCashoutProgress(owner, row.id, {
              state: "failed", filledAtomic: record.filled_atomic, returnedAtomic: record.returned_atomic,
              remainingAtomic: record.remaining_atomic, withdrawable: false, settled: true,
            }) ?? record;
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
          record = await store.updateCashoutProgress(owner, row.id, {
            state: order.state, filledAtomic: order.filledAmountAtomic, returnedAtomic: order.returnedAmountAtomic,
            remainingAtomic: order.remainingAmountAtomic, withdrawable: order.nextActions.includes("withdraw"),
            settled: order.state === "delivered" || (order.state === "returned" && !pendingWithdrawals.some(({ row: withdraw }) =>
              withdraw.summary.metadata?.product === "cashout" && withdraw.summary.metadata.operation === "withdraw" &&
              withdraw.summary.metadata.depositId.toLowerCase() === currentDepositId.toLowerCase())),
          }) ?? record;
        }
      }
    } catch {
      observe("CASHOUT_REFRESH_UNAVAILABLE");
    } finally {
      byAction.set(row.id, record);
    }
  }
  return [...byAction.values()];
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
    read.catch(() => {});
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
  const source = env ?? process.env;
  const recoveryEnv = { ...source, ...Object.fromEntries(binding.directions.offramp!.env.filter((name) => name.endsWith("_ENABLED")).map((name) => [name, "1"])) };
  return createProviderContext({ manifest: provider.manifest, region: binding.region, direction: "offramp", paymentMethodId: method.id, env: recoveryEnv, sandbox });
}

async function readTransactionReceipt(hash: `0x${string}`, signal: AbortSignal): Promise<Pick<TransactionReceipt, "logs">> {
  if (signal.aborted) throw signal.reason;
  return await createPublicClient({ chain: base, transport: http(resolveBaseRpcUrl(), { timeout: 3_000 }) }).getTransactionReceipt({ hash });
}
