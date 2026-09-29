import type { QueryScopePolicy } from "./policy";

export const investAsset = { audience: "public", staleTime: 60_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
