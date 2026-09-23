import { RECENT_TRANSFER_RECIPIENT_LIMIT } from "./contracts/recipients";
import { normalizeResolvedRecipientAddress } from "./recipient-name";

const recipientWarningPattern = /^recipient:\s*(0x[0-9a-fA-F]{40})$/i;

export type SendRecipientSource = {
  kind: string;
  summary: { warnings?: unknown } | null;
};

export function sendRecipientFromWarnings(warnings: unknown): `0x${string}` | null {
  if (!Array.isArray(warnings)) return null;
  for (const warning of warnings) {
    if (typeof warning !== "string") continue;
    const match = recipientWarningPattern.exec(warning.trim());
    if (!match) continue;
    return normalizeResolvedRecipientAddress(match[1]);
  }
  return null;
}

export function recentSendRecipientAddresses(
  records: readonly SendRecipientSource[],
  limit: number = RECENT_TRANSFER_RECIPIENT_LIMIT,
): `0x${string}`[] {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const recipients: `0x${string}`[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!record || record.kind !== "send") continue;
    const address = sendRecipientFromWarnings(record.summary?.warnings);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    recipients.push(address);
    if (recipients.length === limit) break;
  }
  return recipients;
}
