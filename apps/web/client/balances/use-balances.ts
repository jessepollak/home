"use client";

import { useMemo, useRef } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { dataOwnerKey } from "@/client/account/owner-keys";
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
  options: { enabled?: boolean } = {},
): BalancesState & { revalidating?: true } {
  const validSession = isBalancesSession(session) ? session : null;
  const ownerKey = validSession ? dataOwnerKey(validSession) : null;
  const stalePolling = useRef({ identity: "", dataUpdatedAt: 0, completedRefetches: 0 });
  const query = useHomeQuery<BalancesSnapshot>({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "balances", region)
      : ["unauthenticated", "balances-disabled", region],
    enabled: ownerKey !== null && options.enabled !== false,
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
      return parseBalancesSnapshot(
        await fetchBalances(region, signal),
        {
          subject: validSession.subject,
          smartAccountAddress: validSession.smartAccountAddress,
          chainId: 8453,
        },
        region,
      );
    },
  });

  return useMemo(() => {
    if (!ownerKey) return { status: "unavailable", snapshot: null, error: null };
    if (query.isPending) return { status: "loading", snapshot: null, error: null };
    if (query.isError) return { status: "error", snapshot: null, error: "balances-unavailable" };
    return {
      status: "ready",
      snapshot: query.data,
      error: null,
      ...(query.isFetching ? { revalidating: true as const } : {}),
    };
  }, [ownerKey, query.data, query.isError, query.isFetching, query.isPending]);
}

function isBalancesSession(value: BalancesQuerySession | null): value is BalancesQuerySession {
  return Boolean(
    value &&
    value.subject &&
    /^0x[0-9a-fA-F]{40}$/.test(value.smartAccountAddress) &&
    value.chainId === 8453,
  );
}
