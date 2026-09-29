import type { QueryScopePolicy } from "./policy";

export const activityWindow = { audience: "owner", persistence: "memory", staleTime: Infinity, mutatedByActions: false } as const satisfies QueryScopePolicy;
