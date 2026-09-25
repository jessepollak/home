"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { networkFeePolicyScope } from "@/client/query/after-action";
import { ownerQueryKey, useHomeQuery } from "@/client/query/query-client";
import { parseNetworkFeePolicyResponse } from "@/shared/actions/contracts/network-fee";

export function useNetworkFeeReserve(ownerKey: string | null, fetchAccountResource: AccountWalletClient["fetchAccountResource"] | undefined, open: boolean): string | null | undefined {
  const available = Boolean(ownerKey && fetchAccountResource);
  const query = useHomeQuery({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, networkFeePolicyScope) : ["unauthenticated", "network-fee-policy-disabled"],
    enabled: available && open,
    staleTime: 0,
    retry: 2,
    retryDelay: 100,
    queryFn: async ({ signal }) => {
      if (!fetchAccountResource) throw new Error("The network fee policy is unavailable.");
      const response = parseNetworkFeePolicyResponse(await fetchAccountResource("/api/actions/network-fee", { signal }));
      if (!response) throw new Error("The network fee policy is invalid.");
      return response.usdcReserveBaseUnits;
    },
  });
  if (!available) return null;
  if (query.isPending || query.isError || (query.isFetching && query.data === null)) return undefined;
  return query.data;
}

export function maxAmountAfterNetworkFee(availableBaseUnits: string | null | undefined, assetSymbol: string, reserveBaseUnits: string | null | undefined): string | null {
  if (availableBaseUnits == null || !/^\d+$/.test(availableBaseUnits)) return null;
  if (assetSymbol.toUpperCase() !== "USDC") return availableBaseUnits;
  if (reserveBaseUnits === undefined) return "0";
  if (!reserveBaseUnits || !/^\d+$/.test(reserveBaseUnits)) return availableBaseUnits;
  const remaining = BigInt(availableBaseUnits) - BigInt(reserveBaseUnits);
  return (remaining > BigInt(0) ? remaining : BigInt(0)).toString();
}
