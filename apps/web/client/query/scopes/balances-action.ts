import type { QueryScopePolicy } from "./policy";

export const balancesAction = { audience: "owner", persistence: "memory", staleTime: Infinity, mutatedByActions: false } as const satisfies QueryScopePolicy;
