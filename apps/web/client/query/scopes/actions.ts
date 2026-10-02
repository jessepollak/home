import type { QueryScopePolicy } from "./policy";

export const actions = { audience: "owner", persistence: "memory", staleTime: 10_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
