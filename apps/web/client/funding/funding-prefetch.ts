import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { RegionId } from "@/config/regions";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { isServerVerified } from "@/client/account/cdp-client";
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
import { ownerQueryKey, ownerQueryMeta } from "@/client/query/query-client";

type FundingWallet = Pick<AccountWalletClient, "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource">;

type FetchResource = FundingWallet["fetchAccountResource"];

export function fundingProvidersOptions(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, "funding-providers", region) : ["unauthenticated", "funding-providers-disabled", region],
    queryFn: ({ signal }) => fetchResource(`/api/funding/providers?region=${encodeURIComponent(region)}&direction=onramp`, { signal }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
  });
}

export function fundingOpenOrderOptions(owner: string | null, region: RegionId, fetchResource: FetchResource) {
  return queryOptions({
    queryKey: owner ? ownerQueryKey(owner, "funding-open-order", region) : ["unauthenticated", "funding-open-order-disabled", region],
    queryFn: ({ signal }) => fetchResource(`/api/funding/orders?region=${encodeURIComponent(region)}`, { signal }),
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
