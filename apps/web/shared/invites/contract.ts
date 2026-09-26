export const INVITE_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const INVITE_CODE_LENGTH = 10;
export const INVITE_LINK_CONTRACT_VERSION = 1 as const;

export function isInviteCode(value: unknown): value is string {
  return typeof value === "string" && value.length === INVITE_CODE_LENGTH &&
    [...value].every((character) => INVITE_CODE_ALPHABET.includes(character));
}

/** @public constructs the Account invitation URL path in the follow-up UI delivery */
export function invitePath(code: string): string {
  return `/invite/${code}`;
}

export type InviteLinkResponse = { version: typeof INVITE_LINK_CONTRACT_VERSION; code: string };

/** @public consumed by the Account invite-link client in the follow-up UI delivery */
export function parseInviteLinkResponse(value: unknown): InviteLinkResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  return response.version === INVITE_LINK_CONTRACT_VERSION && isInviteCode(response.code)
    ? { version: INVITE_LINK_CONTRACT_VERSION, code: response.code } : null;
}
