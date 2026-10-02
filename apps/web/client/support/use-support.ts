"use client";

import { useEffect, useState } from "react";
import type { AccountWalletClient } from "@/client/account/cdp-client";
import { browserHomeQueryClient, ownerQueryKey, ownerQueryMeta, useHomeQuery, useHomeQueryClient } from "@/client/query/query-client";
import { SUPPORT_CONTRACT_VERSION, parseCustomerSupportResponse, parseCustomerSupportSummary, type CustomerSupportResponse, type CustomerSupportSummary } from "@/shared/support/contract";

export type SupportFetch = AccountWalletClient["fetchAccountResource"];
export type SupportStreamFetch = AccountWalletClient["fetchAccountResponse"];

function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function useSupportConversation(ownerKey: string | null, fetchAccountResource: SupportFetch, open: boolean, streaming: boolean) {
  const visible = usePageVisible();
  return useHomeQuery<CustomerSupportResponse>({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "support-conversation") : ["unauthenticated", "support-conversation"],
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    enabled: Boolean(ownerKey && open && visible),
    refetchInterval: open && visible && !streaming ? 5_000 : false,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = parseCustomerSupportResponse(await fetchAccountResource("/api/support", { signal }));
      if (!response) throw new Error("Invalid support response");
      return response;
    },
  });
}

export function useSupportSummary(ownerKey: string | null, fetchAccountResource: SupportFetch) {
  return useHomeQuery<CustomerSupportSummary>({
    queryKey: ownerKey ? ownerQueryKey(ownerKey, "support-summary") : ["unauthenticated", "support-summary"],
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    enabled: Boolean(ownerKey),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = parseCustomerSupportSummary(await fetchAccountResource("/api/support/summary", { signal }));
      if (!response) throw new Error("Invalid support summary");
      return response;
    },
  });
}

export function useSupportCache(ownerKey: string | null) {
  const client = useHomeQueryClient(browserHomeQueryClient());
  return {
    async conversation(response: CustomerSupportResponse) {
      if (!ownerKey) return;
      const conversationKey = ownerQueryKey(ownerKey, "support-conversation");
      const summaryKey = ownerQueryKey(ownerKey, "support-summary");
      await Promise.all([client.cancelQueries({ queryKey: conversationKey }), client.cancelQueries({ queryKey: summaryKey })]);
      client.setQueryData(conversationKey, response);
      client.setQueryData(summaryKey, { version: SUPPORT_CONTRACT_VERSION, unreadCount: response.conversation?.unreadCount ?? 0 });
    },
    refresh() {
      if (!ownerKey) return;
      void client.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "support-conversation") });
      void client.invalidateQueries({ queryKey: ownerQueryKey(ownerKey, "support-summary") });
    },
  };
}
