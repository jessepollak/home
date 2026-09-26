"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { networkFeePolicyScope } from "@/client/query/after-action";
import { ownerQueryKey, useHomeQuery } from "@/client/query/query-client";
import { parseNetworkFeePolicyResponse } from "@/shared/actions/contracts/network-fee";

export function useNetworkFeeReserve(ownerKey: string | null, fetchAccountResource: AccountWalletClient["fetchAccountResource"] | undefined, open: boolean): { reserve: string | null | undefined; failed: boolean; retry: () => void } {
  const { reserve, failed, retrying, retry } = useNetworkFeeReserveState(ownerKey, fetchAccountResource, open);
  return { reserve, failed: failed && !retrying, retry };
}

type NetworkFeeReserveState = {
  reserve: string | null | undefined;
  failed: boolean;
  retrying: boolean;
  retry: () => void;
};

export function useNetworkFeeReserveState(ownerKey: string | null, fetchAccountResource: AccountWalletClient["fetchAccountResource"] | undefined, open: boolean): NetworkFeeReserveState {
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
  const refetch = query.refetch;
  const retry = () => { void refetch({ cancelRefetch: false }); };
  if (!available) return { reserve: null, failed: false, retrying: false, retry };
  const retrying = query.errorUpdateCount > 0 && query.isFetching && query.data === undefined;
  const failed = query.isError || retrying;
  if (query.isPending || query.isError || (query.isFetching && query.data === null)) return { reserve: undefined, failed, retrying, retry };
  return { reserve: query.data, failed: false, retrying: false, retry };
}

export function maxAmountAfterNetworkFee(availableBaseUnits: string | null | undefined, assetSymbol: string, reserveBaseUnits: string | null | undefined): string | null {
  if (availableBaseUnits == null || !/^\d+$/.test(availableBaseUnits)) return null;
  if (assetSymbol.toUpperCase() !== "USDC") return availableBaseUnits;
  if (reserveBaseUnits === undefined) return "0";
  if (!reserveBaseUnits || !/^\d+$/.test(reserveBaseUnits)) return availableBaseUnits;
  const remaining = BigInt(availableBaseUnits) - BigInt(reserveBaseUnits);
  return (remaining > BigInt(0) ? remaining : BigInt(0)).toString();
}
