import { mutationOptions, type MutationFunction, type MutationOptions, type QueryClient } from "@tanstack/react-query";
import type { OwnerQueryScope } from "./query-scopes";
import { ownerQueryKey } from "./query-client";

export type MutationInvalidation = { scope: OwnerQueryScope; key?: readonly unknown[]; refetchType?: "active" | "all" };
export type HomeMutationMeta<TVariables = unknown> = {
  ownerKey: string;
  invalidates: readonly MutationInvalidation[] | ((variables: TVariables) => readonly MutationInvalidation[]);
};

type OwnerMutationOptions<TData, TVariables, TContext> = Omit<MutationOptions<TData, Error, TVariables, TContext>, "meta" | "mutationFn"> & {
  owner: string | null;
  invalidates: HomeMutationMeta<TVariables>["invalidates"];
  mutationFn: MutationFunction<TData, TVariables>;
};

export function ownerMutation<TData, TVariables, TContext = unknown>({
  owner, invalidates, mutationFn, ...rest
}: OwnerMutationOptions<TData, TVariables, TContext>) {
  return mutationOptions({
    ...rest,
    mutationFn,
    meta: owner !== null ? { ownerKey: owner, invalidates } satisfies HomeMutationMeta<TVariables> : undefined,
  });
}

export async function invalidateMutationScopes(
  client: Pick<QueryClient, "invalidateQueries">,
  meta: unknown,
  variables?: unknown,
): Promise<void> {
  if (!meta || typeof meta !== "object" || !("ownerKey" in meta) || typeof meta.ownerKey !== "string" ||
    !meta.ownerKey.trim() || !("invalidates" in meta)) return;
  const ownerKey = meta.ownerKey;
  const invalidates = typeof meta.invalidates === "function"
    ? (meta.invalidates as (variables: unknown) => unknown)(variables)
    : meta.invalidates;
  if (!Array.isArray(invalidates) || !invalidates.every((item: unknown) =>
    item !== null && typeof item === "object" && "scope" in item && typeof item.scope === "string" &&
    (!("key" in item) || Array.isArray(item.key)) &&
    (!("refetchType" in item) || item.refetchType === "active" || item.refetchType === "all"))) return;
  await Promise.all((invalidates as readonly MutationInvalidation[]).map(({ scope, key, refetchType }) =>
    client.invalidateQueries({
      queryKey: ownerQueryKey(ownerKey, scope, ...(key ?? [])),
      ...(refetchType ? { refetchType } : {}),
    })));
}
