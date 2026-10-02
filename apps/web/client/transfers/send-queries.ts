import type { AccountWalletClient } from "@/client/account/cdp-client";
import { ownerQuery } from "@/client/query/query-options";
import {
  readRecentTransferRecipientsResponse,
  readTransferRecipientNameResponse,
  TRANSFER_RECIPIENTS_VERSION,
  type RecentTransferRecipient,
} from "@/shared/transfers/contracts/recipients";

type FetchResource = AccountWalletClient["fetchAccountResource"];

export function transferRecipientNameQuery(owner: string | null, name: string | null, enabled: boolean, fetchResource: FetchResource | undefined) {
  return ownerQuery<{ name: string; address: `0x${string}` }>({
    owner, scope: "transfers-recipient-name", key: name === null ? [] : [name],
    enabled: enabled && name !== null, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!name || !fetchResource) throw new Error("Transfer recipient name is unavailable.");
      const value = await fetchResource(`/api/transfers/recipient-name?name=${encodeURIComponent(name)}`, { signal });
      const resolved = readTransferRecipientNameResponse(value);
      if (!resolved || resolved.name !== name) throw new Error("Transfer recipient name response is invalid.");
      return resolved;
    },
  });
}

export function recentTransferRecipientsQuery(owner: string | null, enabled: boolean, fetchResource: FetchResource | undefined) {
  return ownerQuery<readonly RecentTransferRecipient[]>({
    owner, scope: "transfers-recent-recipients", enabled: enabled && Boolean(fetchResource), retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!fetchResource) throw new Error("Recent transfer recipients are unavailable.");
      const value: unknown = await fetchResource("/api/transfers/recent-recipients", { signal });
      if (typeof value !== "object" || value === null || !("version" in value) || value.version !== TRANSFER_RECIPIENTS_VERSION ||
        !("recipients" in value) || !Array.isArray(value.recipients)) {
        throw new Error("Recent transfer recipients response is invalid.");
      }
      return readRecentTransferRecipientsResponse(value);
    },
  });
}
