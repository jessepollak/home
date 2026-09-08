import {
  createErrorMarketHistoryResponse,
  getCodexMarketHistory,
} from "@/server/market-data/codex/history";
import {
  isMarketPriceRange,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/server/market-data/codex/history-contract";
import { investAssets, type InvestAssetId } from "@/config/invest-assets";

const allowedAssetIds = new Set<string>(investAssets.map((asset) => asset.id));

function isInvestAssetId(value: string): value is InvestAssetId {
  return allowedAssetIds.has(value);
}

type HistoryReader = (
  assetId: string,
  range: string,
) => Promise<MarketPriceHistoryResponse>;

export function createMarketPriceHistoryHandler(
  readHistory: HistoryReader = getCodexMarketHistory,
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? "";
    const range = url.searchParams.get("range") ?? "";
    const knownAsset = isInvestAssetId(assetId);
    const knownRange = isMarketPriceRange(range);

    if (!knownAsset || !knownRange) {
      return Response.json(
        createUnavailableQueryResponse(
          knownAsset ? assetId : null,
          knownRange ? range : null,
          knownAsset ? "invalid-range" : "unknown-asset",
        ),
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    try {
      const payload = await readHistory(assetId, range);
      const cacheControl = payload.unavailableReason
        ? "public, max-age=30"
        : "public, max-age=30, stale-while-revalidate=30";
      return Response.json(payload, {
        headers: { "Cache-Control": cacheControl },
      });
    } catch {
      return Response.json(createErrorMarketHistoryResponse(assetId, range), {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}

function createUnavailableQueryResponse(
  assetId: MarketPriceHistoryResponse["assetId"],
  range: MarketPriceRange | null,
  unavailableReason: "unknown-asset" | "invalid-range",
): MarketPriceHistoryResponse {
  return {
    version: 1,
    provider: "codex",
    assetId,
    range,
    fetchedAt: null,
    status: "unavailable",
    points: [],
    unavailableReason,
  };
}
