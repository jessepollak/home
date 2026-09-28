import type { QueryScopePolicy } from "./policy";

export const stockTradeEligibility = { audience: "owner", persistence: "owner", staleTime: 30_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
