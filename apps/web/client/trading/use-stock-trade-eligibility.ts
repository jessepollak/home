"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseStockTradeEligibilityResponse } from "@/shared/trading/contract-stock-eligibility";

export function useStockTradeEligibility(
  session: VerifiedAccountSession | null,
  fetchAccountResource: AccountWalletClient["fetchAccountResource"],
) {
  const owner = session?.smartAccount ? dataOwnerKey(session) : null;
  const query = useHomeQuery({
    queryKey: owner ? ownerQueryKey(owner, "stock-trade-eligibility") : ["unauthenticated", "stock-trade-eligibility-disabled"],
    meta: owner ? ownerQueryMeta(owner, "owner") : undefined,
    enabled: owner !== null,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = parseStockTradeEligibilityResponse(await fetchAccountResource("/api/trades/stock-eligibility", { signal }));
      if (!response) throw new Error("Invalid stock trade eligibility response.");
      return response;
    },
  });
  if (!owner) return null;
  if (query.isError) return "unavailable" as const;
  return query.data ?? null;
}
