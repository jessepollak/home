import type { QueryScopePolicy } from "./policy";

export const fundingProviderCustomers = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
