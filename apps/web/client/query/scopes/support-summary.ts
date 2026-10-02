import type { QueryScopePolicy } from "./policy";

export const supportSummary = { audience: "owner", persistence: "memory", staleTime: 60_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
