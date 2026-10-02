import type { QueryScopePolicy } from "./policy";

export const supportConversation = { audience: "owner", persistence: "memory", staleTime: 5_000, mutatedByActions: false } as const satisfies QueryScopePolicy;
