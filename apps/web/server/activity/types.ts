import type { ActivityPage } from "@/shared/activity/types";

export type VerifiedActivityAccount = {
  address: `0x${string}`;
  chainId: 8453;
  verification: "session-smart-account";
};

export type ActivityReadRequest = {
  to: string;
  cursor: string | null;
};

export type ActivityReader = (
  account: VerifiedActivityAccount,
  request: ActivityReadRequest,
  signal?: AbortSignal,
) => Promise<ActivityPage>;
