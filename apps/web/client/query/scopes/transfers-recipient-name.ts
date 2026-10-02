import type { QueryScopePolicy } from "./policy";

export const transfersRecipientName = { audience: "owner", persistence: "memory", staleTime: 0, mutatedByActions: false } as const satisfies QueryScopePolicy;
