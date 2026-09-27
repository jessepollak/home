"use client";

import { queryOptions } from "@tanstack/react-query";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { isTransientAccountResourceFailure } from "@/client/account/resource-failure";
import { tradeAvailabilityScope } from "@/client/query/after-action";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TRADE_AVAILABILITY_CONTRACT_VERSION, parseTradeAvailabilityResponse, type TradeAvailabilityResponse } from "@/shared/trading/contract";

export function retryTradeAvailability(failures: number, error: unknown): boolean {
  return failures < 2 && isTransientAccountResourceFailure(error);
}

export function tradeAvailabilityOptions(
  session: VerifiedAccountSession | null,
  assetId: string,
  fetchAccountResource: AccountWalletClient["fetchAccountResource"],
) {
  const owner = session?.smartAccount ? dataOwnerKey(session) : null;
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, tradeAvailabilityScope, assetId) : ["unauthenticated", "trade-availability-disabled", assetId],
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
    enabled: owner !== null,
    staleTime: 30_000,
    retry: retryTradeAvailability,
    retryDelay: (attempt: number) => Math.min(250 * 2 ** attempt, 1_000),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: tradeAvailabilityRefetchInterval,
    queryFn: async ({ signal }): Promise<TradeAvailabilityResponse> => {
      const response = parseTradeAvailabilityResponse(await fetchAccountResource(`/api/trades?assetId=${encodeURIComponent(assetId)}`, { signal }));
      if (!response || (response.status === "available" && response.token.assetId !== assetId)) throw new Error("Invalid trading availability response.");
      return response;
    },
  });
}

export function tradeAvailabilityRefetchInterval(query: { state: { status: string; data?: TradeAvailabilityResponse } }): number | false {
  const data = query.state.data;
  if (query.state.status === "error" || (data?.status === "unavailable" && data.reason === "chain-unavailable")) return 30_000;
  return data?.status === "available" ? 60_000 : false;
}

export function tradeAvailabilityResult(ownerEnabled: boolean, query: { isError: boolean; data?: TradeAvailabilityResponse }) {
  if (!ownerEnabled) return null;
  if (query.isError) return { version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable" as const, reason: "chain-unavailable" as const };
  return query.data ?? null;
}

export function useTradeAvailability(
  session: VerifiedAccountSession | null,
  assetId: string,
  fetchAccountResource: AccountWalletClient["fetchAccountResource"],
) {
  const query = useHomeQuery(tradeAvailabilityOptions(session, assetId, fetchAccountResource));
  return tradeAvailabilityResult(!!session?.smartAccount, query);
}
