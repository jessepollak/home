import type { QueryScopePolicy } from "./policy";

export const transfersRecentRecipients = { audience: "owner", persistence: "memory", staleTime: 60_000, mutatedByActions: true } as const satisfies QueryScopePolicy;
