"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { isTransientAccountResourceFailure } from "@/client/account/resource-failure";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { TRADE_AVAILABILITY_CONTRACT_VERSION, parseTradeAvailabilityResponse, type TradeAvailabilityResponse } from "@/shared/trading/contract";

export function retryTradeAvailability(failures: number, error: unknown): boolean {
  return failures < 2 && isTransientAccountResourceFailure(error);
}

const refetchFailedTradeAvailability = (query: { state: { status: string } }) => query.state.status === "error";

export function useTradeAvailability(
  session: VerifiedAccountSession | null,
  fetchAccountResource: AccountWalletClient["fetchAccountResource"],
) {
  const owner = session?.smartAccount ? dataOwnerKey(session) : null;
  const query = useHomeQuery<TradeAvailabilityResponse>({
    queryKey: owner ? ownerQueryKey(owner, "trade-availability") : ["unauthenticated", "trade-availability-disabled"],
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
    enabled: owner !== null,
    staleTime: 30_000,
    retry: retryTradeAvailability,
    retryDelay: (attempt: number) => Math.min(250 * 2 ** attempt, 1_000),
    refetchOnWindowFocus: refetchFailedTradeAvailability,
    refetchOnReconnect: refetchFailedTradeAvailability,
    refetchInterval: (query) => query.state.status === "error" ? 30_000 : false,
    queryFn: async ({ signal }) => {
      const response = parseTradeAvailabilityResponse(await fetchAccountResource("/api/trades", { signal }));
      if (!response) throw new Error("Invalid trading availability response.");
      return response;
    },
  });
  if (!owner) return null;
  if (query.isError) return { version: TRADE_AVAILABILITY_CONTRACT_VERSION, status: "unavailable" as const, reason: "provider-unconfigured" as const };
  return query.data ?? null;
}
