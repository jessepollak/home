import type { QueryScopePolicy } from "./policy";

export const fundingOrderIsolated = { audience: "public", staleTime: 4_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
