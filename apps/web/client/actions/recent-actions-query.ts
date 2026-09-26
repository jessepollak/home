import { useEffect, useState } from "react";
import { TransferExecutionError } from "@/shared/transfers/types";
import { assertRecentActionsResponse } from "@/shared/actions/contracts/list";

export async function fetchRecentActions(
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<{ actions: unknown[] }> {
  const value = await fetchOperations(signal);
  assertRecentActionsResponse(value);
  return value;
}

export function retryRecentActions(failures: number, error: unknown): boolean {
  if (failures >= 2 || !(error instanceof TransferExecutionError) || error.reason !== "unavailable") return false;
  const status = (error as TransferExecutionError & { status?: unknown }).status;
  return status === undefined || status === 429 || (typeof status === "number" && status >= 500 && status <= 599);
}

const refetchFailedRecentActions = (query: { state: { status: string } }) => query.state.status === "error";

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

export function recentActionsStatus(query: RecentActionsQueryState): "loading" | "ready" | "error" {
  if (query.isError) {
    const recentlyLoaded = query.hasData && query.errorUpdatedAt - query.dataUpdatedAt <= RECENT_ACTIONS_STALE_TOLERANCE_MS;
    return recentlyLoaded ? "ready" : "error";
  }
  return query.isPending ? "loading" : "ready";
}

export function useRecentActionsStatus(query: RecentActionsQueryState): "loading" | "ready" | "error" {
  const [expiredFor, setExpiredFor] = useState<number | null>(null);
  const status = recentActionsStatus(query);
  const hiddenFailureSince = query.isError && query.hasData && status === "ready" ? query.dataUpdatedAt : null;
  useEffect(() => {
    if (hiddenFailureSince === null) return;
    const delay = Math.max(0, hiddenFailureSince + RECENT_ACTIONS_STALE_TOLERANCE_MS + 1 - Date.now());
    const timer = setTimeout(() => setExpiredFor(hiddenFailureSince), delay);
    return () => clearTimeout(timer);
  }, [hiddenFailureSince]);
  return hiddenFailureSince !== null && expiredFor === hiddenFailureSince ? "error" : status;
}
