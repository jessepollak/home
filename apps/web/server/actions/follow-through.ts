import "server-only";

import type { ActionHandleResolver } from "./reconcile";
import { getDefaultActionHandleResolver, reconcileRow, rotatingWindow, settleRow } from "./settle";
import { emitServerEvent } from "@/server/observability/log";
import { composeDeadline } from "@/server/http/deadline";
import { actionOwnerKey, getActionsStore, ownerFromActionKey, type ActionRow, type ActionsStore } from "./store";
import type { TransferReceiptStatus } from "./receipt";
import { createUserOperationCallDataLookup, type UserOperationCallDataResolution } from "./user-operation-log";
import type { MoneyActionOwner } from "@/shared/money-actions/types";

export type FollowActionDeps = {
  store?: Pick<ActionsStore, "get" | "recordHandle" | "recordOutcome"> & Partial<Pick<ActionsStore,
    "recordReceiptObservation" | "clearReceiptObservation" | "listOpenByAccounts" | "listOpenForFollowUp" | "claimDiscoveredOperation">>;
  resolveHandle?: ActionHandleResolver;
  findUserOperations?: (row: ActionRow, signal?: AbortSignal) => Promise<UserOperationCallDataResolution>;
  readReceipt?: (hash: `0x${string}`, signal?: AbortSignal) => Promise<TransferReceiptStatus>;
  now?: () => number;
};

type FollowOptions = { signal: AbortSignal; route: string; deps?: FollowActionDeps };
type LoopOptions = FollowOptions & {
  deadlineMs: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const FOLLOW_CONCURRENCY = 4;
const FOLLOW_ROW_BUDGET_MS = 15_000;
const DISCOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let defaultUserOperationLookup: ReturnType<typeof createUserOperationCallDataLookup> | null = null;

export async function followAction(row: ActionRow, options: FollowOptions): Promise<ActionRow> {
  return (await followActionStep(row, options)).row;
}

async function followActionStep(row: ActionRow, options: FollowOptions): Promise<{ row: ActionRow; receiptPersisted: boolean }> {
  const owner = ownerFromActionKey(row.owner_key);
  if (!owner || actionOwnerKey(owner) !== row.owner_key || row.provider !== owner.accountProvider ||
    row.account_address !== null && row.account_address.toLowerCase() !== owner.address.toLowerCase() ||
    !row.confirmed_at || options.signal.aborted || row.outcome) return { row, receiptPersisted: false };
  const store = options.deps?.store ?? getActionsStore();
  let current: ActionRow | null;
  try {
    current = await store.get(owner, row.id, { signal: options.signal, timeoutMs: 5_000 });
  } catch (error) {
    if (options.signal.aborted) return { row, receiptPersisted: false };
    throw error;
  }
  if (!current || current.outcome || current.owner_key !== row.owner_key || options.signal.aborted) return { row: current ?? row, receiptPersisted: false };
  const discovered = isDiscoveryCandidate(current, (options.deps?.now ?? Date.now)())
    ? await discoverRow(current, owner, store, options)
    : current;
  if (options.signal.aborted) return { row: discovered, receiptPersisted: false };
  const reconciled = !discovered.transaction_hash && discovered.provider_handle && discovered.provider_handle !== discovered.id
    ? await reconcileRow({ row: discovered, owner, store, resolveHandle: options.deps?.resolveHandle ?? getDefaultActionHandleResolver(),
      signal: options.signal, route: options.route })
    : discovered;
  if (options.signal.aborted) return { row: reconciled, receiptPersisted: false };
  return await settleRow(reconciled, owner, store, options.deps?.readReceipt, options.signal, options.route);
}

function isDiscoveryCandidate(row: ActionRow, nowMs: number): boolean {
  const confirmedAt = row.confirmed_at === null ? Number.NaN : new Date(row.confirmed_at).getTime();
  return (row.provider === "cdp-embedded" || row.provider === "base-account") && row.outcome === null &&
    row.provider_handle === null && row.transaction_hash === null && row.declined_reported_at === null &&
    typeof row.confirmed_call_data_hash === "string" && row.account_address !== null &&
    Number.isFinite(confirmedAt) && nowMs - confirmedAt <= DISCOVERY_MAX_AGE_MS;
}

async function discoverRow(row: ActionRow, owner: MoneyActionOwner, store: FollowStore, options: FollowOptions): Promise<ActionRow> {
  if (!store.claimDiscoveredOperation) return row;
  const startedAt = Date.now();
  const observe = (code: string, outcome: "ok" | "skipped" | "unavailable") => emitServerEvent("action-reconcile", {
    route: options.route, code, outcome, provider: row.provider, owner, durationMs: Date.now() - startedAt,
  });
  try {
    defaultUserOperationLookup ??= createUserOperationCallDataLookup();
    const found = await (options.deps?.findUserOperations ?? defaultUserOperationLookup)(row, options.signal);
    if (found.status !== "complete" || options.signal.aborted) return row;
    const claimed = await store.claimDiscoveredOperation(owner, row.id, {
      matches: found.matches, recordProviderHandle: row.provider === "cdp-embedded",
    }, { signal: options.signal });
    observe(claimed ? "CALL_DATA_MATCH" : "CALL_DATA_MATCH_UNCLAIMED", claimed ? "ok" : "skipped");
    return claimed ?? row;
  } catch {
    if (!options.signal.aborted) observe("CALL_DATA_MATCH_UNAVAILABLE", "unavailable");
    return row;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type FollowStore = NonNullable<FollowActionDeps["store"]>;

async function followRows(
  rows: readonly ActionRow[],
  options: { signal: AbortSignal; route: string; deps?: FollowActionDeps; store: FollowStore; rowBudgetMs: number },
  observe?: (row: ActionRow, result: ActionRow, startedAt: number) => void,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(FOLLOW_CONCURRENCY, rows.length) }, async () => {
    while (next < rows.length) {
      const row = rows[next];
      next += 1;
      if (!row || options.signal.aborted) continue;
      const startedAt = Date.now();
      const result = await followAction(row, {
        signal: composeDeadline(options.signal, options.rowBudgetMs),
        route: options.route, deps: { ...options.deps, store: options.store },
      });
      observe?.(row, result, startedAt);
    }
  });
  const settled = await Promise.allSettled(workers);
  const rejection = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (rejection) throw rejection.reason;
}

export async function followActionUntilSettled(row: ActionRow, options: LoopOptions): Promise<ActionRow> {
  const now = options.deps?.now ?? Date.now;
  const deadline = now() + options.deadlineMs;
  const signal = composeDeadline(options.signal, Number.isFinite(options.deadlineMs) && options.deadlineMs >= 1 && options.deadlineMs <= 2_147_483_647 ? Math.trunc(options.deadlineMs) : 1);
  for (let attempt = 0; !signal.aborted && now() < deadline; attempt++) {
    const result = await followActionStep(row, { ...options, signal });
    row = result.row;
    if (row.outcome || result.receiptPersisted && row.transaction_hash && row.observed_receipt_transaction_hash?.toLowerCase() === row.transaction_hash.toLowerCase() &&
      row.observed_receipt_block_hash && row.observed_receipt_outcome) break;
    if (signal.aborted || now() >= deadline) break;
    await (options.sleep ?? wait)(Math.min(5_000, 2_000 + attempt * 1_000), signal);
  }
  return row;
}

export async function settleOpenActionsForAccounts(
  addresses: readonly string[],
  options: { signal: AbortSignal; limit?: number; route: string; deps?: FollowActionDeps; rowBudgetMs?: number },
): Promise<void> {
  if (!addresses.length || options.signal.aborted) return;
  const store = options.deps?.store ?? getActionsStore();
  if (!store.listOpenByAccounts) throw new Error("Account action lookup is unavailable.");
  const normalized = addresses.filter((address) => /^0x[0-9a-fA-F]{40}$/.test(address)).map((address) => address.toLowerCase());
  if (!normalized.length) return;
  const perWallet = Math.min(200, Math.max(1, options.limit ?? 10));
  const rows = await store.listOpenByAccounts(normalized, new Date(Date.now() - 7 * 86_400_000),
    Math.min(200, perWallet * normalized.length), perWallet);
  if (!rows.length) emitServerEvent("action-reconcile", { route: options.route, code: "WEBHOOK_NO_OPEN_ACTIONS", outcome: "skipped" });
  await followRows(rows, { signal: options.signal, route: options.route, deps: options.deps, store,
    rowBudgetMs: Math.max(1, options.rowBudgetMs ?? FOLLOW_ROW_BUDGET_MS) },
  (row, result, startedAt) => emitServerEvent("action-reconcile", {
    route: options.route, code: result.outcome ? "WEBHOOK_ACTION_SETTLED" : "WEBHOOK_ACTION_OBSERVED",
    outcome: result.outcome ? "ok" : "skipped", provider: row.provider, durationMs: Date.now() - startedAt }));
}

export async function recheckOpenActions(options: { signal: AbortSignal; limit?: number; route: string; deps?: FollowActionDeps; rowBudgetMs?: number }): Promise<void> {
  if (options.signal.aborted) return;
  const store = options.deps?.store ?? getActionsStore();
  const now = options.deps?.now ?? Date.now;
  const rows = await store.listOpenForFollowUp?.(new Date(now() - 30 * 86_400_000), 200) ?? [];
  const selected = rotatingWindow(rows, Math.min(200, Math.max(1, options.limit ?? 10)), now(), 61_000);
  await followRows(selected, { signal: options.signal, route: options.route, deps: options.deps, store,
    rowBudgetMs: Math.max(1, options.rowBudgetMs ?? FOLLOW_ROW_BUDGET_MS) });
}
