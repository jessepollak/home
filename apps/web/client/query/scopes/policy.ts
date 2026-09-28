export type QueryScopePolicy =
  | { audience: "owner"; persistence: "owner" | "memory"; staleTime: number; mutatedByActions: boolean }
  | { audience: "public"; staleTime: number; mutatedByActions: boolean };
