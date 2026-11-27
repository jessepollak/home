import * as z from "zod/mini";
import { parseAddress, requireAddress } from "@/shared/chain/hex";

export const GROWTH_ADMIN_CONTRACT_VERSION = 1 as const;
export const REWARD_DECISION_REASON_MAX = 200;

export const GROWTH_ADMIN_ERROR_CODES = [
  "UNAUTHENTICATED", "AUTH_UNAVAILABLE", "OPERATOR_FORBIDDEN", "NOT_FOUND", "INVALID_REQUEST", "CROSS_ORIGIN", "UNAVAILABLE", "OPERATOR_CHANGED",
  "NOT_QUALIFIED", "NO_LONGER_QUALIFIES", "HISTORY_PENDING", "CAP_REACHED", "BUDGET_EXHAUSTED", "SETTINGS_MISSING",
] as const;
export type GrowthAdminErrorCode = (typeof GROWTH_ADMIN_ERROR_CODES)[number];

const operatorSchema = z.pipe(
  z.custom<`0x${string}`>((value) => parseAddress(value) !== null),
  z.transform((value) => requireAddress(value)),
);
const decisionRequestSchema = z.union([
  z.strictObject({ version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), action: z.literal("approve"), operator: operatorSchema }),
  z.strictObject({
    version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), action: z.literal("reject"), operator: operatorSchema,
    reason: z.string().check(z.refine((value) => value.trim().length >= 1 && value.trim().length <= REWARD_DECISION_REASON_MAX && value.isWellFormed() && !/\p{Cc}/u.test(value))),
  }),
]);
const decisionResponseSchema = z.strictObject({
  version: z.literal(GROWTH_ADMIN_CONTRACT_VERSION), state: z.enum(["approved", "rejected"]),
});
const errorResponseSchema = z.object({ error: z.object({ code: z.enum(GROWTH_ADMIN_ERROR_CODES) }) });

export type RewardDecisionRequest = z.input<typeof decisionRequestSchema>;
export type ParsedRewardDecisionRequest = z.output<typeof decisionRequestSchema>;
export type RewardDecisionResponse = z.output<typeof decisionResponseSchema>;
export type GrowthAdminErrorResponse = z.output<typeof errorResponseSchema>;

export function parseRewardDecisionRequest(value: unknown): ParsedRewardDecisionRequest | null {
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
