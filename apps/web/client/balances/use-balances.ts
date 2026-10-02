"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { createBalanceReadTiming, recordPresentedBalance } from "@/client/observability/balance-performance";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { isInterruptionEligible } from "@/client/account/resource-failure";
import { snapshotSourceTime, type BalanceActionMarker } from "@/client/query/after-action";
import { browserHomeQueryClient, ownerQueryKey, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { ownerQuery } from "@/client/query/query-options";
import type { RegionId } from "@/config/regions";
import { parseBalancesSnapshot } from "@/shared/balances/contract";
import type {
  BalancesSession,
  BalancesSnapshot,
  BalancesState,
  FetchBalances,
} from "@/shared/balances/types";

type BalancesQuerySession = BalancesSession & { accountProvider?: string };

class ProvisionalBalancesFailure extends Error {
  constructor(cause: unknown) {
    super("Provisional balances read failed.", { cause });
  }
}

export type RecoverableBalancesState = BalancesState & {
  revalidating?: true;
  refreshError?: true;
  actionStale?: true;
  retry: () => Promise<void>;
  observation: {
    identity: string | null;
    fetchStatus: "fetching" | "paused" | "idle";
    errorUpdatedAt: number;
    dataUpdatedAt: number;
    failureEligible: boolean;
    hasData: boolean;
  };
};

export const balancesStaleRefetchMs = 3_000;
export const balancesStaleRefetchLimit = 4;

type StalePollingState = {
  identity: string;
  dataUpdatedAt: number;
  completedRefetches: number;
};

export function nextStaleRefetchDelay(
  polling: StalePollingState,
  snapshot: BalancesSnapshot | undefined,
  identity: string,
  dataUpdatedAt: number,
): number | false {
  if (snapshot?.stale !== true) {
    polling.identity = "";
    polling.dataUpdatedAt = 0;
    polling.completedRefetches = 0;
    return false;
  }
  const observationIdentity = `${identity}\u0000${snapshot.fetchedAt}`;
  if (polling.identity !== observationIdentity) {
    polling.identity = observationIdentity;
    polling.dataUpdatedAt = dataUpdatedAt;
    polling.completedRefetches = 0;
  } else if (polling.dataUpdatedAt !== dataUpdatedAt) {
    polling.dataUpdatedAt = dataUpdatedAt;
    polling.completedRefetches += 1;
  }
  return polling.completedRefetches >= balancesStaleRefetchLimit
    ? false
    : balancesStaleRefetchMs;
}

type BalancesOptions = { enabled?: boolean; provisional?: boolean; held?: boolean; paintCachedWhileHeld?: boolean };

export type BalancesDataState = BalancesState & {
  refreshError?: true;
  actionStale?: true;
  retry: () => Promise<void>;
};

export function useBalancesData(
  session: BalancesQuerySession | null,
  region: RegionId,
  fetchBalances: FetchBalances,
  options: Pick<BalancesOptions, "enabled" | "held"> = {},
): BalancesDataState {
  return useBalancesObserver(session, region, fetchBalances, options, true);
}

export function useBalances(
  session: BalancesQuerySession | null,
  region: RegionId,
  fetchBalances: FetchBalances,
  options: BalancesOptions = {},
): RecoverableBalancesState {
  return useBalancesObserver(session, region, fetchBalances, options, false);
}

function useBalancesObserver(
  session: BalancesQuerySession | null,
  region: RegionId,
  fetchBalances: FetchBalances,
  options: BalancesOptions,
  dataOnly: boolean,
): RecoverableBalancesState {
  const validSession = isBalancesSession(session) ? session : null;
  const ownerKey = validSession ? dataOwnerKey(validSession) : null;
  const stalePolling = useRef({ identity: "", dataUpdatedAt: 0, completedRefetches: 0 });
  const heldRegion = useRef<string | null>(null);
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const subscribeToMarker = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  const readMarker = useCallback(() => ownerKey
    ? queryClient.getQueryData<BalanceActionMarker>(ownerQueryKey(ownerKey, "balances-action")) : undefined, [ownerKey, queryClient]);
  const marker = useSyncExternalStore(subscribeToMarker, readMarker, () => undefined);
  const queryOptions = ownerQuery<BalancesSnapshot>({
    owner: ownerKey,
    scope: "balances",
    key: [region],
    enabled: (queryState) => options.enabled !== false && options.held !== true &&
      (!options.provisional || !(queryState.state.error instanceof ProvisionalBalancesFailure)),
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      if (!validSession) throw new Error("Balances are unavailable.");
      try {
        const timing = createBalanceReadTiming();
        const snapshot = parseBalancesSnapshot(
          await fetchBalances(region, signal, timing.mark),
          {
            subject: validSession.subject,
            smartAccountAddress: validSession.smartAccountAddress,
            chainId: 8453,
          },
          region,
        );
        timing.parsed(snapshot);
        return snapshot;
      } catch (error) {
        if (options.provisional) throw new ProvisionalBalancesFailure(error);
        throw error;
      }
    },
  });
  const query = useHomeQuery({
    ...queryOptions,
    notifyOnChangeProps: dataOnly ? () => queryClient.getQueryState(queryOptions.queryKey)?.error instanceof ProvisionalBalancesFailure
      ? ["data", ...(marker !== undefined ? ["dataUpdatedAt" as const] : []), "error", "status", "isPlaceholderData", "fetchStatus"]
      : ["data", ...(marker !== undefined ? ["dataUpdatedAt" as const] : []), "error", "status", "isPlaceholderData"] : undefined,
    refetchInterval: (queryState) => queryState.state.status === "error"
      ? false
      : nextStaleRefetchDelay(
        stalePolling.current,
        queryState.state.data,
        `${ownerKey ?? "unauthenticated"}\u0000${region}`,
        queryState.state.dataUpdatedAt,
      ),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[0] === ownerKey &&
      (heldRegion.current !== `${ownerKey}\u0000${previousQuery.queryKey[2]}` || previousQuery.queryKey[2] === region)
        ? keepPreviousData(previousData) : undefined,
  });

  const identity = ownerKey ? `${ownerKey}\u0000${region}` : null;
  const suppressedFailure = query.isError && query.error instanceof ProvisionalBalancesFailure;
  const refreshError = query.isError && !suppressedFailure;
  const presentedSnapshot = useMemo(() => query.data && refreshError
    ? { ...query.data, stale: true as const } : query.data, [query.data, refreshError]);
  const held = options.held === true;
  const presentedSource = presentedSnapshot ? snapshotSourceTime(presentedSnapshot) : null;
  const actionStale = presentedSnapshot !== undefined && marker !== undefined && marker.fresh[region] !== true &&
    (presentedSource === null || presentedSource <= marker.at || presentedSnapshot.stale === true);

  useEffect(() => {
    if (!ownerKey || marker === undefined || !query.isSuccess || query.isPlaceholderData ||
      query.data === undefined || query.data.stale === true) return;
    const source = snapshotSourceTime(query.data);
    if (source === null || source <= marker.at || marker.fresh[region] === true) return;
    const markerKey = ownerQueryKey(ownerKey, "balances-action");
    const currentMarker = queryClient.getQueryData<BalanceActionMarker>(markerKey);
    if (currentMarker !== undefined && currentMarker.at === marker.at && currentMarker.fresh[region] !== true) {
      queryClient.setQueryData<BalanceActionMarker>(markerKey, (current) => current && current.at === currentMarker.at
        ? { ...current, fresh: { ...current.fresh, [region]: true } } : current);
    }
  }, [ownerKey, region, marker, query.isSuccess, query.isPlaceholderData, query.data, query.dataUpdatedAt, queryClient]);

  useEffect(() => {
    if (held && identity) {
      heldRegion.current = identity;
    } else if (!held && query.data !== undefined && !query.isPlaceholderData) {
      heldRegion.current = null;
    }
  }, [held, identity, query.data, query.isPlaceholderData]);

  useLayoutEffect(() => {
    if (!dataOnly && query.data && !query.isPlaceholderData &&
      ((!held && options.enabled !== false) || (held && options.paintCachedWhileHeld === true))) {
      recordPresentedBalance(query.data);
    }
  }, [dataOnly, held, options.enabled, options.paintCachedWhileHeld, query.data, query.isPlaceholderData]);

  const refetch = query.refetch;
  const retry = useCallback(async () => {
    await refetch({ cancelRefetch: false });
  }, [refetch]);

  const verifiedRefetchDue = suppressedFailure && !options.provisional &&
    ownerKey !== null && options.enabled !== false && !held && query.fetchStatus === "idle";
  useEffect(() => {
    if (verifiedRefetchDue) void refetch({ cancelRefetch: false });
  }, [verifiedRefetchDue, refetch]);

  return useMemo(() => {
    const heldSnapshot = held && options.paintCachedWhileHeld === true && query.data !== undefined && !query.isPlaceholderData;
    const observation = heldSnapshot ? {
      identity,
      fetchStatus: "idle" as const,
      errorUpdatedAt: 0,
      dataUpdatedAt: query.dataUpdatedAt,
      failureEligible: false,
      hasData: true,
    } : {
      identity,
      fetchStatus: query.fetchStatus,
      errorUpdatedAt: query.errorUpdatedAt,
      dataUpdatedAt: query.dataUpdatedAt,
      failureEligible: !suppressedFailure && isInterruptionEligible(query.error),
      hasData: query.data !== undefined,
    };
    if (!ownerKey) {
      return { status: "unavailable", snapshot: null, error: null, retry, observation };
    }
    if (heldSnapshot) {
      return { status: "ready", snapshot: query.data!, error: null, retry, observation, revalidating: true, ...(actionStale ? { actionStale: true as const } : {}) };
    }
    if (held || query.isPending || (suppressedFailure && query.data === undefined)) {
      return { status: "loading", snapshot: null, error: null, retry, observation };
    }
    if (presentedSnapshot) {
      return {
        status: "ready",
        snapshot: presentedSnapshot,
        error: null,
        retry,
        observation,
        ...(actionStale ? { actionStale: true as const } : {}),
        ...(query.isFetching ? { revalidating: true as const } : {}),
        ...(query.isError && !suppressedFailure ? { refreshError: true as const } : {}),
      };
    }
    if (query.isError) {
      return {
        status: "error",
        snapshot: null,
        error: "balances-unavailable",
        retry,
        observation,
      };
    }
    return { status: "loading", snapshot: null, error: null, retry, observation };
  }, [presentedSnapshot, actionStale, held, identity, options.paintCachedWhileHeld, ownerKey, query.data, query.dataUpdatedAt, query.error, query.errorUpdatedAt, query.fetchStatus, query.isError, query.isFetching, query.isPending, query.isPlaceholderData, retry, suppressedFailure]);
}

function isBalancesSession(value: BalancesQuerySession | null): value is BalancesQuerySession {
  return Boolean(
    value &&
    value.subject &&
    /^0x[0-9a-fA-F]{40}$/.test(value.smartAccountAddress) &&
    value.chainId === 8453,
  );
}
