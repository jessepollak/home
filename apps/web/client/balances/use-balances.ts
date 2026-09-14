"use client";

import { useMemo } from "react";
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

export function useBalances(
  session: BalancesQuerySession | null,
  region: RegionId,
  fetchBalances: FetchBalances,
  options: { enabled?: boolean } = {},
): BalancesState & { revalidating?: true } {
  const validSession = isBalancesSession(session) ? session : null;
  const ownerKey = validSession ? dataOwnerKey(validSession) : null;
  const query = useHomeQuery<BalancesSnapshot>({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "balances", region)
      : ["unauthenticated", "balances-disabled", region],
    enabled: ownerKey !== null && options.enabled !== false,
    staleTime: balancesStaleTimeMs,
    retry: false,
    refetchOnWindowFocus: true,
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
