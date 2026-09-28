"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { dataOwnerKey } from "@/client/account/owner-keys";
import { useHomeQuery } from "@/client/query/query-client";
import { ownerQuery } from "@/client/query/query-options";
import type { VerifiedAccountSession } from "@/shared/account/session-types";
import { parseStockTradeEligibilityResponse } from "@/shared/trading/contract-stock-eligibility";

export function useStockTradeEligibility(
  session: VerifiedAccountSession | null,
  fetchAccountResource: AccountWalletClient["fetchAccountResource"],
) {
  const owner = session?.smartAccount ? dataOwnerKey(session) : null;
  const query = useHomeQuery(ownerQuery({
    owner, scope: "stock-trade-eligibility",
    retry: false,
    queryFn: async ({ signal }) => {
      const response = parseStockTradeEligibilityResponse(await fetchAccountResource("/api/trades/stock-eligibility", { signal }));
      if (!response) throw new Error("Invalid stock trade eligibility response.");
      return response;
    },
  }));
  if (!owner) return null;
  if (query.isError) return "unavailable" as const;
  return query.data ?? null;
}
