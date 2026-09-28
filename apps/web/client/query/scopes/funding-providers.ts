import type { QueryScopePolicy } from "./policy";

export const fundingProviders = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
