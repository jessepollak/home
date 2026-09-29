import { trustRestoredFundingProviderCustomers } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const fundingProviderCustomers = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: false, validateRestored: trustRestoredFundingProviderCustomers } as const satisfies QueryScopePolicy;
