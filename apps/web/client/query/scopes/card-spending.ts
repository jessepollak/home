import type { QueryScopePolicy } from "./policy";

export const cardSpending = { audience: "owner", persistence: "memory", staleTime: 15_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
