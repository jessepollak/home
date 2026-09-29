"use client";

import { useHomeQuery } from "@/client/query/query-client";
import { publicQuery } from "@/client/query/query-options";
import { publicResource } from "@/client/query/public-resource";
import { queryViewState } from "@/client/query/query-view-state";
import { parseAssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";

export function resolvedAssetOptions(assetId: string | null) {
  return publicQuery({
    scope: "invest-asset", key: [assetId],
    enabled: assetId !== null,
    gcTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (assetId === null) throw new Error("Missing asset ID");
      const params = new URLSearchParams({ assetId });
      const result = parseAssetResolutionResponse(await publicResource(`/api/invest/asset?${params}`, { signal }));
      if (!result || result.assetId !== assetId) throw new Error("Invalid asset response");
      return result;
    },
  });
}

export function useResolvedAsset(assetId: string | null) {
  const query = useHomeQuery(resolvedAssetOptions(assetId));
  const view = queryViewState(query, {
    hasCachedData: query.data !== undefined,
    degraded: !query.data?.asset && (query.data?.provider === "error" || query.data?.provider === "unavailable"),
  });
  return {
    asset: query.data?.asset ?? null,
    snapshot: query.data?.snapshot ?? null,
    status: assetId === null ? "idle"
      : view === "loading" ? "loading"
      : view === "failed" || view === "failed-with-data" ? "error"
      : query.data?.asset ? "ready" : "missing",
  };
}
