import { trustRestoredBorrow } from "../restored-cache";
import type { QueryScopePolicy } from "./policy";

export const borrow = { audience: "owner", persistence: "owner", staleTime: 15_000, mutatedByActions: true, validateRestored: trustRestoredBorrow } as const satisfies QueryScopePolicy;
