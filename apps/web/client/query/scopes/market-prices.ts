import type { QueryScopePolicy } from "./policy";

export const marketPrices = { audience: "public", staleTime: 60_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
