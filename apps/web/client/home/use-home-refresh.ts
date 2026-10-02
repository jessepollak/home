"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { isVerifiedActivitySession } from "@/shared/activity/contract";
import type { FetchActivity } from "@/client/activity/types";
import { refreshActivityThroughController } from "@/client/activity/use-activity";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { activityWindowScope, initialActivityWindowEnd } from "@/client/query/after-action";
import {
  browserHomeQueryClient,
  ownerQueryKey,
  publicQueryKey,
  useHomeQueryClient,
} from "@/client/query/query-client";
import type { QueryScope } from "@/client/query/query-scopes";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import type { RegionId } from "@/config/regions";

const homeRefreshScope = {
  balances: "balances",
  activity: "activity",
  actions: "actions",
  vaults: "savings-vaults",
  borrow: "borrow",
  borrowMarket: "borrow-market",
} as const satisfies Record<string, QueryScope>;
export const homeRefreshScopes: readonly QueryScope[] = Object.values(homeRefreshScope);

export type HomeRefreshSource = "balances" | "activity" | "actions" | "rates";
export type HomeRefreshState = { phase: "idle" } | { phase: "refreshing" } | { phase: "complete" } |
  { phase: "partial"; failed: readonly HomeRefreshSource[] } | { phase: "failed" };
export type HomeRefreshOutcome = Exclude<HomeRefreshState, { phase: "idle" } | { phase: "refreshing" }> |
  { phase: "superseded" };

export function useHomeRefresh(input: {
  session: VerifiedAccountSession | null;
  regionId: RegionId;
  fetchActivity: FetchActivity;
  enabled: boolean;
}): { state: HomeRefreshState; refresh: () => Promise<HomeRefreshOutcome>; dismiss: () => void } {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const session = isVerifiedActivitySession(input.session) ? input.session : null;
  const ownerKey = session ? dataOwnerKey(session) : null;
  const scope = `${ownerKey ?? "signed-out"}\u0000${input.regionId}\u0000${input.enabled}`;
  const [result, setResult] = useState<{ scope: string; state: HomeRefreshState }>({ scope, state: { phase: "idle" } });
  if (result.scope !== scope) setResult({ scope, state: { phase: "idle" } });
  const generation = useRef(0);
  const mounted = useRef(false);
  const prefetchKey = useRef<QueryKey | null>(null);
  const cycle = useRef<{ generation: number; promise: Promise<HomeRefreshOutcome> } | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      cycle.current = null;
      const key = prefetchKey.current;
      if (key) {
        void queryClient.cancelQueries({ queryKey: key, exact: true });
        queryClient.removeQueries({ queryKey: key, exact: true });
        prefetchKey.current = null;
      }
    };
  }, [scope, queryClient]);

  const dismiss = useCallback(() => setResult({ scope, state: { phase: "idle" } }), [scope]);
  const refresh = useCallback((): Promise<HomeRefreshOutcome> => {
    if (cycle.current?.generation === generation.current) return cycle.current.promise;
    if (!input.enabled || !session || !ownerKey || !mounted.current) {
      return Promise.resolve({ phase: "superseded" });
    }
    const currentGeneration = generation.current;
    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    const active = (key: QueryKey, exact = false) => queryClient.getQueryCache().findAll({
      queryKey: key, exact, type: "active",
    }).length > 0;
    const balancesKey = ownerQueryKey(ownerKey, homeRefreshScope.balances);
    const actionsKey = ownerQueryKey(ownerKey, homeRefreshScope.actions);
    const vaultsKey = publicQueryKey(homeRefreshScope.vaults);
    const borrowKey = ownerQueryKey(ownerKey, homeRefreshScope.borrow, "overview");
    const borrowMarketKey = ownerQueryKey(ownerKey, homeRefreshScope.borrowMarket);
    const windowEnd = queryClient.getQueryData<string>(ownerQueryKey(ownerKey, activityWindowScope)) ?? initialActivityWindowEnd();
    const activityKey = ownerQueryKey(ownerKey, homeRefreshScope.activity, windowEnd);
    const attempted = [
      active(balancesKey),
      active(activityKey) || queryClient.getQueryCache().findAll({ queryKey: activityKey }).some((q) => q.state.data !== undefined),
      active(actionsKey),
      active(vaultsKey, true) || active(borrowKey, true) || active(borrowMarketKey),
    ];
    const refetch = (key: QueryKey, exact = false) => queryClient.refetchQueries(
      { queryKey: key, exact, type: "active" },
      { cancelRefetch: false, throwOnError: true },
    );
    setResult({ scope, state: { phase: "refreshing" } });
    void queryClient.cancelQueries({ queryKey: actionsKey, type: "inactive" });
    void queryClient.invalidateQueries({ queryKey: actionsKey, refetchType: "none" });
    const sources: readonly HomeRefreshSource[] = ["balances", "activity", "actions", "rates"];
    let ownedPrefetchKey: QueryKey | null = null;
    const promise = Promise.allSettled([
      refetch(balancesKey),
      refreshActivityThroughController({
        queryClient, ownerKey, session, regionId: input.regionId, fetchActivity: input.fetchActivity,
        isCurrent,
        onPrefetchKey: (key) => {
          if (key && isCurrent()) {
            ownedPrefetchKey = key;
            prefetchKey.current = key;
          } else if (!key && prefetchKey.current === ownedPrefetchKey) {
            prefetchKey.current = null;
          }
        },
      }),
      refetch(actionsKey),
      Promise.allSettled([refetch(vaultsKey, true), refetch(borrowKey, true), refetch(borrowMarketKey)]).then((results) => {
        if (results.some((result) => result.status === "rejected")) throw new Error("Rates refresh failed.");
      }),
    ]).then((results): HomeRefreshOutcome => {
      if (!isCurrent()) return { phase: "superseded" };
      const failed = sources.filter((_, index) => results[index]?.status === "rejected");
      const outcome: HomeRefreshOutcome = failed.length === 0 ? { phase: "complete" }
        : failed.length === attempted.filter(Boolean).length ? { phase: "failed" }
          : { phase: "partial", failed };
      setResult({ scope, state: outcome });
      return outcome;
    }).catch((): HomeRefreshOutcome => {
      if (!isCurrent()) return { phase: "superseded" };
      const outcome = { phase: "failed" } as const;
      setResult({ scope, state: outcome });
      return outcome;
    }).finally(() => {
      if (cycle.current?.promise === promise) cycle.current = null;
    });
    cycle.current = { generation: currentGeneration, promise };
    return promise;
  }, [input.enabled, input.fetchActivity, input.regionId, ownerKey, queryClient, scope, session]);
  return { state: result.scope === scope ? result.state : { phase: "idle" }, refresh, dismiss };
}
