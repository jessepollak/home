"use client";

import { useEffect, useMemo, useState } from "react";
import { publicResource } from "@/client/query/public-resource";
import { browserHomeQueryClient, publicQueryKey, useHomeInfiniteQuery, useHomeQueryClient } from "@/client/query/query-client";
import {
  isInvestSearchAddressQuery,
  investSearchSearchParams,
  normalizeInvestSearchQuery,
  parseInvestSearchResponse,
  rankInvestSearchResults,
  type InvestSearchPage,
  type InvestSearchResult,
} from "@/shared/invest/contracts/search";
import type { MarketSnapshot } from "@/shared/invest/invest-market";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Schedule = (callback: () => void, milliseconds: number) => () => void;

function scheduleTimeout(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

export function useInvestSearch(
  input: string,
  composing = false,
  { endpoint = "/api/invest/search", fetchImpl = fetch, schedule = scheduleTimeout }: { endpoint?: string; fetchImpl?: FetchLike; schedule?: Schedule } = {},
) {
  const normalized = normalizeInvestSearchQuery(input);
  const [active, setActive] = useState("");
  useEffect(() => {
    if (composing || normalized === null) return;
    return schedule(() => setActive(normalized), !normalized || isInvestSearchAddressQuery(normalized) ? 0 : 200);
  }, [normalized, composing, schedule]);

  const queryClient = useHomeQueryClient(browserHomeQueryClient());
  const queryKey = useMemo(() => publicQueryKey("invest-search", endpoint, active), [endpoint, active]);
  const query = useHomeInfiniteQuery({
    queryKey,
    enabled: active.length > 0 && !composing && normalized === active,
    initialPageParam: 0,
    staleTime: 60_000,
    gcTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam, signal }) => {
      const params = investSearchSearchParams({ query: active, offset: pageParam });
      const page = parseInvestSearchResponse(await publicResource(`${endpoint}?${params}`, { signal, fetchImpl }));
      if (!page || page.query !== active || page.offset !== pageParam) {
        throw new Error("Invalid search response");
      }
      return page;
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
  useEffect(() => {
    if (normalized === active || !active) return;
    void queryClient.cancelQueries({ queryKey, exact: true });
  }, [normalized, active, queryClient, queryKey]);

  const visible = !composing && normalized !== null && active === normalized && active !== "";
  const pages: readonly InvestSearchPage[] | undefined = visible ? query.data?.pages : undefined;
  const { results, snapshots } = useMemo(() => {
    const results: InvestSearchResult[] = [];
    const snapshots: MarketSnapshot[] = [];
    const addresses = new Set<string>();
    const snapshotIds = new Set<string>();
    for (const page of pages ?? []) {
      if (page.query !== active) continue;
      for (const result of page.results) {
        const key = `${result.asset.chainId}:${result.asset.contractAddress.toLowerCase()}`;
        if (addresses.has(key)) continue;
        addresses.add(key);
        results.push(result);
      }
      for (const snapshot of page.snapshots) {
        if (snapshotIds.has(snapshot.assetId)) continue;
        snapshotIds.add(snapshot.assetId);
        snapshots.push(snapshot);
      }
    }
    return { results: rankInvestSearchResults(results), snapshots };
  }, [pages, active]);
  const last = pages?.at(-1);
  const providerFailed = pages?.some((page) => page.query === active && (page.provider === "error" || page.provider === "unavailable")) ?? false;
  return {
    results,
    snapshots,
    status: !input.trim()
      ? "idle" as const
      : normalized === null
        ? "error" as const
        : !visible || query.isPending
          ? "loading" as const
          : query.isError || (providerFailed && results.length === 0)
            ? "error" as const
            : "ready" as const,
    partial: pages?.some((page) => page.query === active && page.coverage === "partial") ?? false,
    nextOffset: last?.query === active ? last.nextOffset : null,
    loadingMore: visible && query.isFetchingNextPage,
    loadMoreError: visible && query.isFetchNextPageError,
    loadMore: () => { if (last?.nextOffset !== null && last?.nextOffset !== undefined && !query.isFetchingNextPage) void query.fetchNextPage(); },
    retryLoadMore: () => { if (!query.isFetchingNextPage) void query.fetchNextPage(); },
    retry: () => { if (visible) void query.refetch(); },
  };
}
