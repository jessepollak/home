import * as z from "zod/mini";
import {
  normalizeResolvedRecipientAddress,
  normalizeTransferRecipientName,
} from "../recipient-name";

export const TRANSFER_RECIPIENTS_VERSION = 1 as const;
export const RECENT_TRANSFER_RECIPIENT_LIMIT = 3;

const addressSchema = z.custom<`0x${string}`>((value) => normalizeResolvedRecipientAddress(value) !== null)
  .check(z.overwrite((value) => normalizeResolvedRecipientAddress(value) ?? value));
const nameSchema = z.string().check(
  z.refine((value) => normalizeTransferRecipientName(value) !== null),
  z.overwrite((value) => normalizeTransferRecipientName(value) ?? value),
);
const recipientNameResponseSchema = z.object({
  version: z.literal(TRANSFER_RECIPIENTS_VERSION),
  name: nameSchema,
  address: addressSchema,
});
const recentRecipientSchema = z.object({
  address: addressSchema,
  name: z.pipe(z.optional(z.unknown()), z.transform(normalizeTransferRecipientName)),
});
const recentRecipientsResponseSchema = z.object({
  version: z.literal(TRANSFER_RECIPIENTS_VERSION),
  recipients: z.pipe(z.array(z.unknown()), z.transform((entries) => {
    const recipients: RecentTransferRecipient[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const result = recentRecipientSchema.safeParse(entry);
      if (!result.success) continue;
      const identity = result.data.address.toLowerCase();
      if (seen.has(identity)) continue;
      seen.add(identity);
      recipients.push(result.data);
      if (recipients.length === RECENT_TRANSFER_RECIPIENT_LIMIT) break;
    }
    return recipients;
  })),
});

export type TransferRecipientNameResponse = z.output<typeof recipientNameResponseSchema>;
export type RecentTransferRecipient = z.output<typeof recentRecipientSchema>;
export type RecentTransferRecipientsResponse = z.output<typeof recentRecipientsResponseSchema>;

export function readTransferRecipientNameResponse(
  value: unknown,
): { name: string; address: `0x${string}` } | null {
  const result = recipientNameResponseSchema.safeParse(value);
  return result.success ? { name: result.data.name, address: result.data.address } : null;
}

export function readRecentTransferRecipientsResponse(
  value: unknown,
): RecentTransferRecipient[] {
  const result = recentRecipientsResponseSchema.safeParse(value);
  return result.success ? result.data.recipients : [];
}
