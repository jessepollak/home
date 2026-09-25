import type { QueryClient } from "@tanstack/react-query";
import type { VerifiedAccountSession } from "@/client/account/session-client";
import { dataOwnerKey as dataOwnerKeyForSession } from "@/client/account/owner-keys";
import { reportClientError } from "@/client/observability/client-reporter";
import {
  freshUntilMoved,
  type BalanceSnapshot,
  type FreshUntilMovedClock,
} from "./fresh-until-moved";
import { ownerQueryKey, ownerQueryMeta } from "./query-client";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import { BALANCES_VERSION, type BalancesSnapshot } from "@/shared/balances/types";

export const afterActionScopes = [
  "balances",
  "activity",
  "borrow",
  "actions",
] as const;

export const indexedScopes = ["activity", "borrow", "actions"] as const;

export const activityWindowScope = "activity-window";
export const networkFeePolicyScope = "network-fee-policy";
const activityWindowQuantumMs = 60_000;

export function invalidateNetworkFeePolicy(queryClient: Pick<QueryClient, "invalidateQueries">): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[1] === networkFeePolicyScope,
  });
}

export function initialActivityWindowEnd(now = Date.now()): string {
  return new Date(Math.floor(now / activityWindowQuantumMs) * activityWindowQuantumMs).toISOString();
}

export async function invalidateIndexedScopes(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  dataOwnerKey: string,
): Promise<void> {
  await Promise.all(indexedScopes.map((scope) =>
    queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, scope) })
  ));
}

export function advanceActivityWindowEnd(
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData">,
  dataOwnerKey: string,
  now = Date.now(),
): string {
  const key = ownerQueryKey(dataOwnerKey, activityWindowScope);
  const previous = queryClient.getQueryData<string>(key);
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  const nextTime = Number.isFinite(previousTime)
    ? Math.max(now, previousTime + 1)
    : Math.floor(now / activityWindowQuantumMs) * activityWindowQuantumMs;
  const next = new Date(nextTime).toISOString();
  queryClient.setQueryData(key, next);
  return next;
}

export async function invalidateAfterAction(
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData" | "invalidateQueries">,
  dataOwnerKey: string,
  now = Date.now(),
): Promise<void> {
  advanceActivityWindowEnd(queryClient, dataOwnerKey, now);
  await Promise.all(afterActionScopes.map((scope) =>
    queryClient.invalidateQueries({ queryKey: ownerQueryKey(dataOwnerKey, scope) })
  ));
}

type FetchVerifiedResource = (
  endpoint: "/api/actions" | "/api/balances",
  signal?: AbortSignal,
  query?: string,
) => Promise<unknown>;

export type BalanceFreshnessState = {
  runs: Map<string, () => void>;
  moved: Set<string>;
  starts: Map<string, number>;
};

export function createBalanceFreshnessState(): BalanceFreshnessState {
  return { runs: new Map(), moved: new Set(), starts: new Map() };
}

export function resetBalanceFreshness(state: BalanceFreshnessState): void {
  for (const cancel of state.runs.values()) cancel();
  state.runs.clear();
  state.moved.clear();
  state.starts.clear();
}

export async function startBalanceFreshness(input: {
  actionId: string;
  session: VerifiedAccountSession | null;
  queryClient: QueryClient;
  fetchVerifiedResource: FetchVerifiedResource;
  state: BalanceFreshnessState;
  clock?: FreshUntilMovedClock;
}): Promise<void> {
  const { actionId, session, queryClient, fetchVerifiedResource, state } = input;
  if (!session?.smartAccount || state.moved.has(actionId)) return;
  const start = (state.starts.get(actionId) ?? 0) + 1;
  state.starts.set(actionId, start);
  const isLatestStart = () => state.starts.get(actionId) === start && !state.moved.has(actionId);
  const dataOwnerKey = dataOwnerKeyForSession(session);
  let actionsValue: unknown;
  try {
    actionsValue = await fetchVerifiedResource("/api/actions");
  } catch (error) {
    void reportClientError({
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "The balance freshness listing read failed.",
      route: window.location.pathname,
    });
    return;
  }
  if (!isLatestStart()) return;
  const assetIds = affectedAssetIds(actionsValue, actionId);
  if (assetIds.length === 0) return;
  const balanceQueries = queryClient.getQueryCache().findAll({
    queryKey: [dataOwnerKey, "balances"],
  });
  const hasSnapshot = balanceQueries.some((q) => isBalancesSnapshot(q.state.data));
  if (!hasSnapshot || !isLatestStart()) return;
  const initial: Record<string, string | null> = Object.fromEntries(assetIds.map((id) => [id, null]));
  const byFreshness = [...balanceQueries].sort(
    (a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt,
  );
  for (const q of byFreshness) {
    const data = q.state.data;
    if (!isBalancesSnapshot(data)) continue;
    const found = selectAffectedBalances(data, assetIds);
    for (const [key, value] of Object.entries(found)) {
      if (value !== null) initial[key] = value;
    }
  }
  const run = freshUntilMoved({
    initial,
    clock: input.clock,
    readFresh: async () => {
      const merged: Record<string, string | null> = Object.fromEntries(assetIds.map((id) => [id, null]));
      for (const balanceQuery of balanceQueries) {
        const region = balanceQuery.queryKey[2];
        if (typeof region !== "string") continue;
        const snapshot = await queryClient.fetchQuery({
          queryKey: balanceQuery.queryKey,
          staleTime: 0,
          retry: false,
          meta: ownerQueryMeta(dataOwnerKey, "owner"),
          queryFn: async ({ signal }) => parseBalancesSnapshot(
            await fetchVerifiedResource(
              "/api/balances",
              signal,
              new URLSearchParams({ region }).toString(),
            ),
            {
              subject: session.user.subject,
              smartAccountAddress: session.smartAccount!.address,
              chainId: 8453,
            },
            region as import("@/config/regions").RegionId,
          ),
        });
        const found = selectAffectedBalances(snapshot, assetIds);
        for (const [key, value] of Object.entries(found)) {
          if (value !== null) merged[key] = value;
        }
      }
      return merged;
    },
  });
  state.runs.get(actionId)?.();
  state.runs.set(actionId, run.cancel);
  void run.result
    .then((result) => settleBalanceFreshness({ queryClient, dataOwnerKey, state, actionId, result }))
    .finally(() => {
      if (state.runs.get(actionId) === run.cancel) state.runs.delete(actionId);
    });
}

export async function settleBalanceFreshness(input: {
  queryClient: Pick<QueryClient, "invalidateQueries">;
  dataOwnerKey: string;
  state: BalanceFreshnessState;
  actionId: string;
  result: "moved" | "timed-out";
}): Promise<void> {
  if (input.result === "moved") input.state.moved.add(input.actionId);
  await Promise.all([
    invalidateIndexedScopes(input.queryClient, input.dataOwnerKey),
    invalidateNetworkFeePolicy(input.queryClient),
  ]);
}

export async function applyActionHandleEffects(input: {
  path: string;
  body: unknown;
  dataOwnerKey: string;
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData" | "invalidateQueries">;
  startBalanceFreshness: (actionId: string) => void | Promise<void>;
}): Promise<void> {
  const actionId = new URL(input.path, "https://home.invalid").pathname.split("/")[3];
  if (!actionId) return;
  const body = isRecord(input.body) ? input.body : {};
  if (typeof body.transactionHash === "string") {
    void input.startBalanceFreshness(actionId);
    await Promise.all([
      invalidateAfterAction(input.queryClient, input.dataOwnerKey),
      invalidateNetworkFeePolicy(input.queryClient),
    ]);
    return;
  }
  await input.queryClient.invalidateQueries({
    queryKey: ownerQueryKey(input.dataOwnerKey, "actions"),
  });
  if (typeof body.providerHandle === "string") void input.startBalanceFreshness(actionId);
}

function affectedAssetIds(value: unknown, actionId: string): string[] {
  if (!isRecord(value) || !Array.isArray(value.actions)) return [];
  const action = value.actions.find((item) => isRecord(item) && item.id === actionId);
  if (!isRecord(action) || !isRecord(action.summary) || !Array.isArray(action.summary.amounts)) return [];
  return Array.from(new Set(action.summary.amounts.flatMap((amount) =>
    isRecord(amount) && typeof amount.assetId === "string" ? [amount.assetId] : [],
  )));
}

function selectAffectedBalances(
  snapshot: BalancesSnapshot,
  assetIds: readonly string[],
): BalanceSnapshot {
  const requested = new Set(assetIds);
  const result: Record<string, string | null> = Object.fromEntries(
    assetIds.map((assetId) => [assetId, null]),
  );
  for (const holding of snapshot.holdings) {
    for (const identity of [holding.id, holding.key]) {
      if (!requested.has(identity)) continue;
      result[identity] = holding.balance.baseUnits;
    }
  }
  return result;
}

function isBalancesSnapshot(value: unknown): value is BalancesSnapshot {
  return isRecord(value) && value.version === BALANCES_VERSION && Array.isArray(value.holdings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
