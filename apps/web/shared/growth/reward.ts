import type { GrowthSettings } from "@/shared/operator-settings/growth";

export const INVITE_REWARD_STATES = ["joined", "saved", "qualified", "approved", "rejected", "disqualified", "ineligible"] as const;
export type InviteRewardState = (typeof INVITE_REWARD_STATES)[number];

export const INVITE_REWARD_RISK_SIGNALS = [
  "funded-by-inviter", "funded-by-customer", "signup-burst", "inviter-burst", "withdrew-after-window", "preexisting-shares",
] as const;
export type InviteRewardRiskSignal = (typeof INVITE_REWARD_RISK_SIGNALS)[number];

export type InviteRewardTerms = Pick<GrowthSettings, "inviterRewardAtoms" | "minDepositAtoms" | "holdDays" | "countries" | "termsText">;

export const GROWTH_RISK_THRESHOLDS = {
  signupBurstCount: 5, signupBurstWindowHours: 1,
  inviterBurstCount: 3, inviterBurstWindowHours: 24,
  fundingLookbackDays: 7, withdrawalAfterWindowHours: 72,
} as const;
