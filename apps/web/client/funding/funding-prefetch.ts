import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { RegionId } from "@/config/regions";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { isServerVerified } from "@/client/account/cdp-client";
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
import { ownerQueryKey, ownerQueryMeta } from "@/client/query/query-client";
import { assertFundingProvidersResponse } from "@/shared/funding/contracts/providers";
import { assertFundingOpenOrderResponse } from "@/shared/funding/contracts/open-order";
import { assertFundingProviderCustomersResponse } from "@/shared/funding/contracts/provider-customers";

type FundingWallet = Pick<AccountWalletClient, "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource">;

type FetchResource = FundingWallet["fetchAccountResource"];

export function fundingProvidersOptions(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, "funding-providers", region) : ["unauthenticated", "funding-providers-disabled", region],
    queryFn: async ({ signal }) => {
      const response = await fetchResource(`/api/funding/providers?region=${encodeURIComponent(region)}&direction=onramp`, { signal });
      assertFundingProvidersResponse(response, "onramp", region);
      return response;
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
  });
}

export function fundingOpenOrderOptions(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, "funding-open-order", region) : ["unauthenticated", "funding-open-order-disabled", region],
    queryFn: async ({ signal }) => {
      const response = await fetchResource(`/api/funding/orders?region=${encodeURIComponent(region)}`, { signal });
      assertFundingOpenOrderResponse(response, region);
      return response;
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
  });
}

export function fundingProviderCustomersOptions(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, "funding-provider-customers", region) : ["unauthenticated", "funding-provider-customers-disabled", region],
    queryFn: async ({ signal }) => {
      const response = await fetchResource(`/api/funding/provider-customers?region=${encodeURIComponent(region)}`, { signal });
      assertFundingProviderCustomersResponse(response, region);
      return response;
    },
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
  });
}

export function prefetchAddMoneyMethods(wallet: FundingWallet, region: RegionId, regionReady: boolean, queryClient: QueryClient) {
  const session = isServerVerified(wallet) ? wallet.session : null;
  if (!uiBoundary(wallet) || !session?.smartAccount?.address || !regionReady || region === "GLOBAL") return;
  const owner = dataOwnerKey(session);
  void queryClient.prefetchQuery(fundingProvidersOptions(owner, region, wallet.fetchAccountResource));
  void queryClient.prefetchQuery(fundingOpenOrderOptions(owner, region, wallet.fetchAccountResource));
}
