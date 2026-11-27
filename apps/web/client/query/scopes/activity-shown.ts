import { trustRestoredShownActivity } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const activityShown = { audience: "owner", persistence: "owner", staleTime: Infinity, gcTime: Infinity, mutatedByActions: false, validateRestored: trustRestoredShownActivity } as const satisfies QueryScopePolicy;
