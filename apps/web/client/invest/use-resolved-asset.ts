"use client";

import { publicQueryKey, useHomeQuery } from "@/client/query/query-client";
import { deploymentHeaders } from "@/client/query/deployment-headers";
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
      const response = await fetch(`/api/invest/asset?${params}`, {
        headers: { ...deploymentHeaders(), accept: "application/json" },
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Asset request failed");
      const result = parseAssetResolutionResponse(await response.json());
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
