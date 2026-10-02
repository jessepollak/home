import * as z from "zod/mini";

export const INVITE_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const INVITE_CODE_LENGTH = 10;
export const INVITE_LINK_CONTRACT_VERSION = 1 as const;

const inviteCodeSchema = z.string().check(
  z.length(INVITE_CODE_LENGTH),
  z.refine((value) => [...value].every((character) => INVITE_CODE_ALPHABET.includes(character))),
);
const inviteLinkResponseSchema = z.strictObject({
  version: z.literal(INVITE_LINK_CONTRACT_VERSION),
  code: inviteCodeSchema,
});

export function isInviteCode(value: unknown): value is string {
  return inviteCodeSchema.safeParse(value).success;
}

/** @public constructs the Account invitation URL path in the follow-up UI delivery */
export function invitePath(code: string): string {
  return `/invite/${code}`;
}

export type InviteLinkResponse = z.output<typeof inviteLinkResponseSchema>;

/** @public consumed by the Account invite-link client in the follow-up UI delivery */
export function parseInviteLinkResponse(value: unknown): InviteLinkResponse | null {
  const result = inviteLinkResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
