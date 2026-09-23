import {
  normalizeResolvedRecipientAddress,
  normalizeTransferRecipientName,
} from "../recipient-name";

export const TRANSFER_RECIPIENTS_VERSION = 1 as const;
export const RECENT_TRANSFER_RECIPIENT_LIMIT = 3;

export type TransferRecipientNameResponse = {
  version: typeof TRANSFER_RECIPIENTS_VERSION;
  name: string;
  address: `0x${string}`;
};

export type RecentTransferRecipient = {
  address: `0x${string}`;
  name: string | null;
};

export type RecentTransferRecipientsResponse = {
  version: typeof TRANSFER_RECIPIENTS_VERSION;
  recipients: RecentTransferRecipient[];
};

export function readTransferRecipientNameResponse(
  value: unknown,
): { name: string; address: `0x${string}` } | null {
  if (!isRecord(value) || value.version !== TRANSFER_RECIPIENTS_VERSION) return null;
  const name = normalizeTransferRecipientName(value.name);
  const address = normalizeResolvedRecipientAddress(value.address);
  if (!name || !address) return null;
  return { name, address };
}

export function readRecentTransferRecipientsResponse(
  value: unknown,
): RecentTransferRecipient[] {
  if (!isRecord(value) || value.version !== TRANSFER_RECIPIENTS_VERSION || !Array.isArray(value.recipients)) {
    return [];
  }
  const recipients: RecentTransferRecipient[] = [];
  const seen = new Set<string>();
  for (const entry of value.recipients) {
    if (!isRecord(entry)) continue;
    const address = normalizeResolvedRecipientAddress(entry.address);
    const identity = address?.toLowerCase();
    if (!address || !identity || seen.has(identity)) continue;
    seen.add(identity);
    recipients.push({
      address,
      name: entry.name === null || entry.name === undefined
        ? null
        : normalizeTransferRecipientName(entry.name),
    });
    if (recipients.length === RECENT_TRANSFER_RECIPIENT_LIMIT) break;
  }
  return recipients;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
