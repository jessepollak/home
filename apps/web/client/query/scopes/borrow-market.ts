import { trustRestoredBorrowMarket } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const borrowMarket = { audience: "owner", persistence: "owner", staleTime: 0, mutatedByActions: true, validateRestored: trustRestoredBorrowMarket } as const satisfies QueryScopePolicy;
