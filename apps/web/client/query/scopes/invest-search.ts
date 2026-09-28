import type { QueryScopePolicy } from "./policy";

export const investSearch = { audience: "public", staleTime: 60_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
