import type { QueryScopePolicy } from "./policy";

export const basename = { audience: "public", staleTime: 5 * 60_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
