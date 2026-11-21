import * as z from "zod/mini";

export const GROWTH_ADMIN_CONTRACT_VERSION = 1 as const;
export const REWARD_DECISION_REASON_MAX = 200;

export const GROWTH_ADMIN_ERROR_CODES = [
  "UNAUTHENTICATED", "AUTH_UNAVAILABLE", "OPERATOR_FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST", "CROSS_ORIGIN", "UNAVAILABLE",
  "NOT_QUALIFIED", "NO_LONGER_QUALIFIES", "HISTORY_PENDING", "CAP_REACHED", "BUDGET_EXHAUSTED", "SETTINGS_MISSING",
] as const;
export type GrowthAdminErrorCode = (typeof GROWTH_ADMIN_ERROR_CODES)[number];

const decisionRequestSchema = z.union([
  z.strictObject({ version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), action: z.literal("approve") }),
  z.strictObject({
    version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), action: z.literal("reject"),
    reason: z.string().check(z.refine((value) => value.trim().length >= 1 && value.trim().length <= REWARD_DECISION_REASON_MAX && value.isWellFormed() && !/\p{Cc}/u.test(value))),
  }),
]);
const decisionResponseSchema = z.strictObject({
  version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), state: z.enum(["approved", "rejected"]),
});
const errorResponseSchema = z.object({ error: z.object({ code: z.enum(GROWTH_ADMIN_ERROR_CODES) }) });

export type RewardDecisionRequest = z.output<typeof decisionRequestSchema>;
export type RewardDecisionResponse = z.output<typeof decisionResponseSchema>;
export type GrowthAdminErrorResponse = z.output<typeof errorResponseSchema>;

export function parseRewardDecisionRequest(value: unknown): RewardDecisionRequest | null {
  const result = decisionRequestSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function parseRewardDecisionResponse(value: unknown): RewardDecisionResponse | null {
  const result = decisionResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function parseGrowthAdminErrorResponse(value: unknown): GrowthAdminErrorResponse | null {
  const result = errorResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}
