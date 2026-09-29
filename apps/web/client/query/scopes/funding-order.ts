import { trustRestoredFundingOrder } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const fundingOrder = { audience: "owner", persistence: "owner", staleTime: 4_000, mutatedByActions: false, validateRestored: trustRestoredFundingOrder } as const satisfies QueryScopePolicy;
