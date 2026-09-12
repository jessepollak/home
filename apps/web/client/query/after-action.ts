import type { QueryClient } from "@tanstack/react-query";
import type { VerifiedAccountSession } from "@/client/account/session-client";
import { freshUntilMoved, type BalanceSnapshot } from "./fresh-until-moved";
import { ownerQueryKey, ownerQueryMeta } from "./query-client";
import { parsePortfolioValuationSnapshot } from "@/shared/portfolio/parse-valuation";
import type { PortfolioValuationSnapshot } from "@/shared/portfolio/valuation-types";

export const afterActionScopes = [
  "valuation",
  "portfolio",
  "activity",
  "savings-positions",
  "borrow",
  "actions",
] as const;

/** Indexer-backed scopes: refreshed again once balances have visibly moved. */
export const indexedScopes = ["activity", "savings-positions", "borrow", "actions"] as const;

export const activityWindowScope = "activity-window";
const activityWindowQuantumMs = 60_000;

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
  endpoint: "/api/actions" | "/api/portfolio/valuation",
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
}): Promise<void> {
  const { actionId, session, queryClient, fetchVerifiedResource, state } = input;
  if (!session?.smartAccount || state.moved.has(actionId)) return;
  const start = (state.starts.get(actionId) ?? 0) + 1;
  state.starts.set(actionId, start);
  const isLatestStart = () => state.starts.get(actionId) === start && !state.moved.has(actionId);
  const dataOwnerKey = `${session.user.subject}\u0000${session.smartAccount.address.toLowerCase()}\u00008453\u0000${session.accountProvider}`;
  let actionsValue: unknown;
  try {
    actionsValue = await fetchVerifiedResource("/api/actions");
  } catch {
    return;
  }
  if (!isLatestStart()) return;
  const assetIds = affectedAssetIds(actionsValue, actionId);
  if (assetIds.length === 0) return;
  const valuationQueries = queryClient.getQueryCache().findAll({
    queryKey: [dataOwnerKey, "valuation"],
  });
  const hasSnapshot = valuationQueries.some((q) => isPortfolioValuationSnapshot(q.state.data));
  if (!hasSnapshot || !isLatestStart()) return;
  const initial: Record<string, string | null> = Object.fromEntries(assetIds.map((id) => [id, null]));
  for (const q of valuationQueries) {
    const data = q.state.data;
    if (!isPortfolioValuationSnapshot(data)) continue;
    const found = selectAffectedBalances(data, assetIds);
    for (const [key, value] of Object.entries(found)) {
      if (value !== null) initial[key] = value;
    }
  }
  const run = freshUntilMoved({
    initial,
    readFresh: async () => {
      const merged: Record<string, string | null> = Object.fromEntries(assetIds.map((id) => [id, null]));
      for (const valuationQuery of valuationQueries) {
        const region = valuationQuery.queryKey[2];
        if (typeof region !== "string") continue;
        const snapshot = await queryClient.fetchQuery({
          queryKey: valuationQuery.queryKey,
          staleTime: 0,
          retry: false,
          meta: ownerQueryMeta(dataOwnerKey, "memory"),
          queryFn: async ({ signal }) => parsePortfolioValuationSnapshot(
            await fetchVerifiedResource(
              "/api/portfolio/valuation",
              signal,
              new URLSearchParams({ region, fresh: "1" }).toString(),
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

/**
 * Indexers (activity, Morpho positions) lag the chain; refresh them once the
 * balances have visibly moved (or the run timed out), not only at hash-post time.
 */
export async function settleBalanceFreshness(input: {
  queryClient: Pick<QueryClient, "invalidateQueries">;
  dataOwnerKey: string;
  state: BalanceFreshnessState;
  actionId: string;
  result: "moved" | "timed-out";
}): Promise<void> {
  if (input.result === "moved") input.state.moved.add(input.actionId);
  await invalidateIndexedScopes(input.queryClient, input.dataOwnerKey);
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
    await invalidateAfterAction(input.queryClient, input.dataOwnerKey);
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
  snapshot: PortfolioValuationSnapshot,
  assetIds: readonly string[],
): BalanceSnapshot {
  const requested = new Set(assetIds);
  const result: Record<string, string | null> = Object.fromEntries(
    assetIds.map((assetId) => [assetId, null]),
  );
  for (const holding of snapshot.inventory.holdings) {
    if (!requested.has(holding.id)) continue;
    result[holding.id] = holding.kind === "direct"
      ? holding.balanceBaseUnits
      : holding.sharesBaseUnits;
  }
  return result;
}

function isPortfolioValuationSnapshot(value: unknown): value is PortfolioValuationSnapshot {
  return isRecord(value) && value.version === 2 && isRecord(value.inventory) &&
    Array.isArray(value.inventory.holdings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
