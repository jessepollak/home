import type { QueryScopePolicy } from "./policy";

export const cards = { audience: "owner", persistence: "memory", staleTime: 15_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
