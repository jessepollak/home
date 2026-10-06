import { trustRestoredBalanceActionMarker } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const balancesAction = { audience: "owner", persistence: "owner", validateRestored: trustRestoredBalanceActionMarker, staleTime: Infinity, gcTime: Infinity, mutatedByActions: false } as const satisfies QueryScopePolicy;
