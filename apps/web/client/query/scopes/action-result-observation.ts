import type { QueryScopePolicy } from "./policy";

export const actionResultObservation = { audience: "owner", persistence: "memory", staleTime: 30_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
