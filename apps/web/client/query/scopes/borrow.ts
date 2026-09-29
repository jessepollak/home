import type { QueryScopePolicy } from "./policy";

export const borrow = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
