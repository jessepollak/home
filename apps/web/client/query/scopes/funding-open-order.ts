import { trustRestoredFundingOpenOrder } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const fundingOpenOrder = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: false, validateRestored: trustRestoredFundingOpenOrder } as const satisfies QueryScopePolicy;
