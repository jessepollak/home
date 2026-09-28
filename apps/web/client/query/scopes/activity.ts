import type { QueryScopePolicy } from "./policy";

export const activity = { audience: "owner", persistence: "owner", staleTime: 10_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
