import { trustRestoredBalances } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const balances = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: true, validateRestored: trustRestoredBalances } as const satisfies QueryScopePolicy;
