import { useEffect, useState } from "react";
import { isTransientAccountResourceFailure } from "@/client/account/resource-failure";
import { queryViewState } from "@/client/query/query-view-state";
import { ownerQuery } from "@/client/query/query-options";
import { reconcileBalanceBoundaries } from "@/client/query/after-action";
import { parseRecentActionsPayload, type RecentActionsPayload } from "@/shared/actions/contracts/list";
import type { VerifiedAccountSession } from "@/shared/account/session-types";

export const recentActionsPath = "/api/actions";

type RecentActionsRead = RecentActionsPayload & { readSequence: number };
let recentActionsReadSequence = 0;

export function getRecentActionsReadSequence(): number {
  return recentActionsReadSequence;
}

export function retryRecentActions(failures: number, error: unknown): boolean {
  return failures < 2 && isTransientAccountResourceFailure(error);
}

export const refetchFailedRecentActions = (query: { state: { status: string } }) => query.state.status === "error";

type RecentActionsInput = {
  owner: string | null;
  session: VerifiedAccountSession | null;
  fetchOperations: (signal?: AbortSignal) => Promise<unknown>;
};

export function recentActionsQuery(input: RecentActionsInput) {
  return ownerQuery<RecentActionsRead>({
    owner: input.owner && input.session ? input.owner : null,
    scope: "actions",
    retry: retryRecentActions,
    retryDelay: (attempt) => Math.min(500 * 3 ** attempt, 1_500),
    refetchOnWindowFocus: refetchFailedRecentActions,
    refetchOnReconnect: refetchFailedRecentActions,
    queryFn: async ({ signal, client }, owner) => {
      if (!input.session) throw new Error("Recent actions are unavailable.");
      const readSequence = ++recentActionsReadSequence;
      const payload = parseRecentActionsPayload(await input.fetchOperations(signal), input.session);
      signal.throwIfAborted();
      reconcileBalanceBoundaries({ queryClient: client, dataOwnerKey: owner, payload });
      return { ...payload, readSequence };
    },
  });
}

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
