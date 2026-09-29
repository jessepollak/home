import type { QueryScopePolicy } from "./policy";

export const identityVerification = { audience: "owner", persistence: "memory", staleTime: 0, mutatedByActions: false } as const satisfies QueryScopePolicy;
