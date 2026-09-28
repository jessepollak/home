import type { QueryScopePolicy } from "./policy";

export const fundingOrder = { audience: "owner", persistence: "owner", staleTime: 4_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
