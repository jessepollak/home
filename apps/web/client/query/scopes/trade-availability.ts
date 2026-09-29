import { trustRestoredTradeAvailability } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const tradeAvailability = { audience: "owner", persistence: "owner", staleTime: 30_000, mutatedByActions: true, validateRestored: trustRestoredTradeAvailability } as const satisfies QueryScopePolicy;
