import type { QueryScopePolicy } from "./policy";

export const activityOrders = { audience: "owner", persistence: "owner", staleTime: 10_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
