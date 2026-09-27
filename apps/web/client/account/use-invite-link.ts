"use client";

import type { AccountWalletClient } from "@/client/account/cdp-client";
import { ownerQueryKey, ownerQueryMeta, useHomeQuery } from "@/client/query/query-client";
import { parseInviteLinkResponse, invitePath } from "@/shared/invites/contract";

export function useInviteLink({
  ownerKey,
  fetchAccountResource,
}: {
  ownerKey: string | null;
  fetchAccountResource: AccountWalletClient["fetchAccountResource"];
}) {
  return useHomeQuery({
    queryKey: ownerKey
      ? ownerQueryKey(ownerKey, "invite-link")
      : ["unauthenticated", "invite-link-disabled"],
    enabled: Boolean(ownerKey),
    meta: ownerKey ? ownerQueryMeta(ownerKey, "memory") : undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        const response = parseInviteLinkResponse(
          await fetchAccountResource("/api/invites/link", { signal }),
        );
        if (!response) throw new Error("Invalid invite link response");
        return `${window.location.origin}${invitePath(response.code)}`;
      } catch (error) {
        if (error && typeof error === "object" && "status" in error &&
            (error.status === 403 || error.status === 503)) return null;
        throw error;
      }
    },
  });
}
