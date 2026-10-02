"use client";

import { useCallback, useMemo } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { browserHomeQueryClient, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { ownerQuery } from "@/client/query/query-options";
import { parseCardSpendingResponse, type CardSpendingResponse } from "@/shared/cards/allowance-contract";

export function useCardSpending({ ownerKey, fetchAccountResource }: {
  ownerKey: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
}) {
  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const options = useMemo(() => ownerQuery({
    owner: ownerKey,
    scope: "card-spending",
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<CardSpendingResponse> => {
      const response = parseCardSpendingResponse(await fetchAccountResource("/api/cards/spending", { signal }));
      if (!response) throw new Error("Invalid card spending response");
      return response;
    },
  }), [ownerKey, fetchAccountResource]);
  const query = useHomeQuery(options);
  const queryKey = options.queryKey;
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey, exact: true }), [queryClient, queryKey]);
  return { query, refresh };
}
