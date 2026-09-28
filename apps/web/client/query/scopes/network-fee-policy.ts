import type { QueryScopePolicy } from "./policy";

export const networkFeePolicy = { audience: "owner", persistence: "memory", staleTime: 0, mutatedByActions: true } as const satisfies QueryScopePolicy;
