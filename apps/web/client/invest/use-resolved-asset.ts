"use client";

import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { publicResource } from "@/client/query/public-resource";
import { parseAssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";

export function useResolvedAsset(assetId: string | null) {
  const query = useHomeQuery({
    queryKey: publicQueryKey("invest-asset", assetId),
    enabled: assetId !== null,
    staleTime: 60_000,
    gcTime: 300_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ assetId: assetId! });
      const result = parseAssetResolutionResponse(await publicResource(`/api/invest/asset?${params}`, { signal }));
      if (!result || result.assetId !== assetId) throw new Error("Invalid asset response");
      return result;
    },
  });
  return {
    asset: query.data?.asset ?? null,
    snapshot: query.data?.snapshot ?? null,
    status: assetId === null ? "idle"
      : query.isPending ? "loading"
      : query.isError || (!query.data.asset && (query.data.provider === "error" || query.data.provider === "unavailable")) ? "error"
      : query.data.asset ? "ready" : "missing",
  };
}
