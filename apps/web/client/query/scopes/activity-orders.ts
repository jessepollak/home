import { trustRestoredActivityOrders } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const activityOrders = { audience: "owner", persistence: "owner", staleTime: 10_000, mutatedByActions: true, validateRestored: trustRestoredActivityOrders } as const satisfies QueryScopePolicy;
