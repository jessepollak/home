import { trustRestoredFundingProviders } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const fundingProviders = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: false, validateRestored: trustRestoredFundingProviders } as const satisfies QueryScopePolicy;
