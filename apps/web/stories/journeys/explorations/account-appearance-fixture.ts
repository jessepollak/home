import type { AccountWalletClient } from "@/client/account/cdp-client";

export type InviteState = "loaded" | "loading" | "unavailable" | "error";
export const accountAppearanceAddress = "0x1111111111111111111111111111111111111111";

export function createInviteFetcher(inviteState: InviteState): AccountWalletClient["fetchAccountResource"] {
  return async () => {
    if (inviteState === "loading") return new Promise<unknown>(() => {});
    if (inviteState === "unavailable") throw Object.assign(new Error("unavailable"), { status: 403 });
    if (inviteState === "error") throw new Error("network");
    return { version: 1, code: "abcdefghjk" };
  };
}
