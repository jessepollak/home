import { trustRestoredActions } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const actions = { audience: "owner", persistence: "owner", staleTime: 10_000, mutatedByActions: true, validateRestored: trustRestoredActions } as const satisfies QueryScopePolicy;
