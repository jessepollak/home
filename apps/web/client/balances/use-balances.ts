"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { isInterruptionEligible } from "@/client/account/resource-failure";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
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

export const balancesStaleTimeMs = 15_000;
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

export function useBalances(
  session: BalancesQuerySession | null,
  region: RegionId,
  fetchBalances: FetchBalances,
  options: { enabled?: boolean; provisional?: boolean; held?: boolean } = {},
): RecoverableBalancesState {
  const validSession = isBalancesSession(session) ? session : null;
  const ownerKey = validSession ? dataOwnerKey(validSession) : null;
  const stalePolling = useRef({ identity: "", dataUpdatedAt: 0, completedRefetches: 0 });
  const query = useHomeQuery<BalancesSnapshot>({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "balances", region)
      : ["unauthenticated", "balances-disabled", region],
    enabled: (queryState) => ownerKey !== null && options.enabled !== false && options.held !== true &&
      (!options.provisional || !(queryState.state.error instanceof ProvisionalBalancesFailure)),
    staleTime: balancesStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (queryState) => queryState.state.status === "error"
      ? false
      : nextStaleRefetchDelay(
        stalePolling.current,
        queryState.state.data,
        `${ownerKey ?? "unauthenticated"}\u0000${region}`,
        queryState.state.dataUpdatedAt,
      ),
    meta: ownerKey ? ownerQueryMeta(ownerKey, "owner") : undefined,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[0] === ownerKey ? keepPreviousData(previousData) : undefined,
    queryFn: async ({ signal }) => {
      if (!validSession) throw new Error("Balances are unavailable.");
      try {
        return parseBalancesSnapshot(
          await fetchBalances(region, signal),
          {
            subject: validSession.subject,
            smartAccountAddress: validSession.smartAccountAddress,
            chainId: 8453,
          },
          region,
        );
      } catch (error) {
        if (options.provisional) throw new ProvisionalBalancesFailure(error);
        throw error;
      }
    },
  });

  const identity = ownerKey ? `${ownerKey}\u0000${region}` : null;
  const suppressedFailure = query.isError && query.error instanceof ProvisionalBalancesFailure;
  const held = options.held === true;

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
    const observation = {
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
    if (held || query.isPending || (suppressedFailure && query.data === undefined)) {
      return { status: "loading", snapshot: null, error: null, retry, observation };
    }
    if (query.data) {
      const snapshot = query.isError && !suppressedFailure
        ? { ...query.data, stale: true as const }
        : query.data;
      return {
        status: "ready",
        snapshot,
        error: null,
        retry,
        observation,
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
  }, [held, identity, ownerKey, query.data, query.dataUpdatedAt, query.error, query.errorUpdatedAt, query.fetchStatus, query.isError, query.isFetching, query.isPending, retry, suppressedFailure]);
}

function isBalancesSession(value: BalancesQuerySession | null): value is BalancesQuerySession {
  return Boolean(
    value &&
    value.subject &&
    /^0x[0-9a-fA-F]{40}$/.test(value.smartAccountAddress) &&
    value.chainId === 8453,
  );
}
