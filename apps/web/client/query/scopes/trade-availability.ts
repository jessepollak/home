import type { QueryScopePolicy } from "./policy";

export const tradeAvailability = { audience: "owner", persistence: "owner", staleTime: 30_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
