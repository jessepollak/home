import type { QueryKey } from "@tanstack/react-query";

export type RestoredQueryEntry = { ownerKey: string; queryKey: QueryKey };
export type TrustedRestoredData = { data: unknown };
export type RestoredQueryGuard = (data: unknown, entry: RestoredQueryEntry) => TrustedRestoredData | null;

export type QueryScopePolicy =
  | { audience: "owner"; persistence: "owner"; staleTime: number; gcTime?: number; mutatedByActions: boolean; validateRestored: RestoredQueryGuard }
  | { audience: "owner"; persistence: "memory"; staleTime: number; mutatedByActions: boolean }
  | { audience: "public"; staleTime: number; mutatedByActions: boolean };
