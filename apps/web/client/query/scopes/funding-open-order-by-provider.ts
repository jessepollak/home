import { trustRestoredFundingOpenOrderByProvider } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const fundingOpenOrderByProvider = { audience: "owner", persistence: "owner", staleTime: 0, mutatedByActions: false, validateRestored: trustRestoredFundingOpenOrderByProvider } as const satisfies QueryScopePolicy;
