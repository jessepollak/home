import { trustRestoredActivity } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const activity = { audience: "owner", persistence: "owner", staleTime: 10_000, mutatedByActions: true, validateRestored: trustRestoredActivity } as const satisfies QueryScopePolicy;
