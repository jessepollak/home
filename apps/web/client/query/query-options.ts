import {
  infiniteQueryOptions,
  queryOptions,
  skipToken,
  type InfiniteData,
  type QueryFunctionContext,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  type UndefinedInitialDataOptions,
  type UndefinedInitialDataInfiniteOptions,
} from "@tanstack/react-query";
import { disabledQueryKey, ownerQueryKey, ownerQueryMeta, publicQueryKey } from "./query-client";
import { queryScopes, type OwnerQueryScope, type PublicQueryScope } from "./query-scopes";

type OwnerOptions<T, TData> = Omit<UndefinedInitialDataOptions<T, Error, TData, QueryKey>, "queryKey" | "queryFn" | "staleTime" | "meta" | "enabled"> & {
  owner: string | null;
  scope: OwnerQueryScope;
  key?: readonly unknown[];
  queryFn: (context: QueryFunctionContext<QueryKey>, owner: string) => Promise<T>;
  enabled?: UseQueryOptions<T, Error, TData, QueryKey>["enabled"];
};

type PublicOptions<T, TData> = Omit<UndefinedInitialDataOptions<T, Error, TData, QueryKey>, "queryKey" | "queryFn" | "staleTime" | "meta"> & {
  scope: PublicQueryScope;
  key?: readonly unknown[];
  queryFn: (context: QueryFunctionContext<QueryKey>) => Promise<T>;
};

export function ownerQuery<T, TData = T>({ owner, scope, key = [], queryFn, enabled, ...rest }: OwnerOptions<T, TData>) {
  const policy = queryScopes[scope];
  return queryOptions({
    ...rest,
    queryKey: owner ? ownerQueryKey(owner, scope, ...key) : disabledQueryKey(scope, ...key),
    queryFn: owner ? (context: QueryFunctionContext<QueryKey>) => queryFn(context, owner) : skipToken,
    enabled: (query) => owner !== null && (typeof enabled === "function" ? enabled(query) : enabled !== false),
    staleTime: policy.staleTime,
    meta: owner ? ownerQueryMeta(owner, policy.persistence) : undefined,
  });
}

export function publicQuery<T, TData = T>({ scope, key = [], queryFn, ...rest }: PublicOptions<T, TData>) {
  return queryOptions({ ...rest, queryKey: publicQueryKey(scope, ...key), queryFn, staleTime: queryScopes[scope].staleTime });
}

type OwnerInfiniteOptions<T, TPageParam, TData> = Omit<UndefinedInitialDataInfiniteOptions<T, Error, TData, QueryKey, TPageParam>, "queryKey" | "queryFn" | "staleTime" | "meta" | "enabled"> & {
  owner: string | null;
  scope: OwnerQueryScope;
  key?: readonly unknown[];
  queryFn: (context: QueryFunctionContext<QueryKey, TPageParam>, owner: string) => Promise<T>;
  enabled?: UseInfiniteQueryOptions<T, Error, TData, QueryKey, TPageParam>["enabled"];
};

type PublicInfiniteOptions<T, TPageParam, TData> = Omit<UndefinedInitialDataInfiniteOptions<T, Error, TData, QueryKey, TPageParam>, "queryKey" | "queryFn" | "staleTime" | "meta"> & {
  scope: PublicQueryScope;
  key?: readonly unknown[];
  queryFn: (context: QueryFunctionContext<QueryKey, TPageParam>) => Promise<T>;
};

/** @public adopted by the activity query migration */
export function ownerInfiniteQuery<T, TPageParam, TData = InfiniteData<T, TPageParam>>({
  owner, scope, key = [], queryFn, enabled, ...rest
}: OwnerInfiniteOptions<T, TPageParam, TData>) {
  const policy = queryScopes[scope];
  return infiniteQueryOptions({
    ...rest,
    queryKey: owner ? ownerQueryKey(owner, scope, ...key) : disabledQueryKey(scope, ...key),
    queryFn: owner ? (context: QueryFunctionContext<QueryKey, TPageParam>) => queryFn(context, owner) : skipToken,
    enabled: (query) => owner !== null && (typeof enabled === "function" ? enabled(query) : enabled !== false),
    staleTime: policy.staleTime,
    meta: owner ? ownerQueryMeta(owner, policy.persistence) : undefined,
  });
}

/** @public adopted by the activity and invest query migrations */
export function publicInfiniteQuery<T, TPageParam, TData = InfiniteData<T, TPageParam>>({
  scope, key = [], queryFn, ...rest
}: PublicInfiniteOptions<T, TPageParam, TData>) {
  return infiniteQueryOptions({ ...rest, queryKey: publicQueryKey(scope, ...key), queryFn, staleTime: queryScopes[scope].staleTime });
}
