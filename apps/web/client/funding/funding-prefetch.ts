import type { QueryClient } from "@tanstack/react-query";
import type { RegionId } from "@/config/regions";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { isServerVerified } from "@/client/account/cdp-client";
import { dataOwnerKey, uiBoundary } from "@/client/account/owner-keys";
import { fundingOpenOrderQuery, fundingProvidersQuery } from "./funding-queries";

type FundingWallet = Pick<AccountWalletClient, "ownerKey" | "status" | "verification" | "session" | "fetchAccountResource">;

export function prefetchAddMoneyMethods(wallet: FundingWallet, region: RegionId, regionReady: boolean, queryClient: QueryClient) {
  const session = isServerVerified(wallet) ? wallet.session : null;
  if (!uiBoundary(wallet) || !session?.smartAccount?.address || !regionReady || region === "GLOBAL") return;
  const owner = dataOwnerKey(session);
  void queryClient.prefetchQuery(fundingProvidersQuery(owner, region, "onramp", wallet.fetchAccountResource));
  void queryClient.prefetchQuery(fundingOpenOrderQuery(owner, region, wallet.fetchAccountResource));
}
