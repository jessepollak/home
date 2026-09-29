import { trustRestoredStockTradeEligibility } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const stockTradeEligibility = { audience: "owner", persistence: "owner", staleTime: 30_000, mutatedByActions: false, validateRestored: trustRestoredStockTradeEligibility } as const satisfies QueryScopePolicy;
