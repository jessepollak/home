import { useEffect, useState } from "react";
import { isTransientAccountResourceFailure } from "@/client/account/resource-failure";
import { assertRecentActionsResponse } from "@/shared/actions/contracts/list";
import { queryViewState } from "@/client/query/query-view-state";

export async function fetchRecentActions(
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<{ actions: unknown[] }> {
  const value = await fetchOperations(signal);
  assertRecentActionsResponse(value);
  return value;
}

export function retryRecentActions(failures: number, error: unknown): boolean {
  return failures < 2 && isTransientAccountResourceFailure(error);
}

export const refetchFailedRecentActions = (query: { state: { status: string } }) => query.state.status === "error";

export const recentActionsQueryOptions = {
  staleTime: 10_000,
  retry: retryRecentActions,
  retryDelay: (attempt: number) => Math.min(500 * 3 ** attempt, 1_500),
  refetchOnWindowFocus: refetchFailedRecentActions,
  refetchOnReconnect: refetchFailedRecentActions,
};

const RECENT_ACTIONS_STALE_TOLERANCE_MS = 120_000;

type RecentActionsQueryState = {
  hasData: boolean;
  isPending: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
};

export function recentActionsStatus(query: RecentActionsQueryState, { tolerateStaleError = true }: { tolerateStaleError?: boolean } = {}): "loading" | "ready" | "error" {
  const recentlyLoaded = tolerateStaleError && query.hasData &&
    query.errorUpdatedAt - query.dataUpdatedAt <= RECENT_ACTIONS_STALE_TOLERANCE_MS;
  const view = queryViewState(
    { status: query.isError ? "error" : query.isPending ? "pending" : "success" },
    { hasCachedData: query.isError ? recentlyLoaded : query.hasData },
  );
  if (view === "failed") return "error";
  return view === "loading" && query.isPending ? "loading" : "ready";
}

export function useRecentActionsStatus(query: RecentActionsQueryState, options: { tolerateStaleError?: boolean } = {}): "loading" | "ready" | "error" {
  const tolerateStaleError = options.tolerateStaleError !== false;
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  const status = recentActionsStatus(query, { tolerateStaleError });
  const hiddenFailureSince = tolerateStaleError && query.isError && query.hasData && status === "ready" ? query.dataUpdatedAt : null;
  useEffect(() => {
    if (hiddenFailureSince === null) return;
    const delay = Math.max(0, hiddenFailureSince + RECENT_ACTIONS_STALE_TOLERANCE_MS + 1 - Date.now());
    const timer = setTimeout(() => setExpiredFor(hiddenFailureSince), delay);
    return () => clearTimeout(timer);
  }, [hiddenFailureSince]);
  return hiddenFailureSince !== null && expiredFor === hiddenFailureSince ? "error" : status;
}
