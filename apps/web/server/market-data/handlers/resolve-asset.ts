import "server-only";

import { resolveAsset } from "@/server/market-data/resolve-asset";
import { ASSET_RESOLUTION_VERSION, parseAssetResolutionRequest, type AssetResolutionResponse } from "@/shared/invest/contracts/asset-resolution";

export function createResolveAssetHandler(readAsset: typeof resolveAsset = resolveAsset) {
  return async function GET(request: Request) {
    const assetId = parseAssetResolutionRequest(new URL(request.url).searchParams);
    if (!assetId) return Response.json({ error: "invalid-asset" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const result = await readAsset(assetId);
      if (result.assetId !== assetId) throw new Error("Mismatched asset identity");
      const cacheControl = result.asset && (result.provider === "ok" || result.provider === "skipped")
        ? "public, max-age=30, stale-while-revalidate=30" : "no-store";
      return Response.json(result, { headers: { "Cache-Control": cacheControl } });
    } catch {
      return Response.json({ version: ASSET_RESOLUTION_VERSION, assetId, asset: null, source: null, snapshot: null, provider: "error" } satisfies AssetResolutionResponse, { headers: { "Cache-Control": "no-store" } });
    }
  };
}
