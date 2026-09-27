import "server-only";

import {
  createErrorMarketStatsResponse,
  getCodexMarketStats,
} from "@/server/market-data/codex/market-stats";
import { getInvestHistoryAdmission } from "@/server/market-data/codex/history-admission";
import {
  isDynamicMarketPriceAssetId,
  resolveMarketPriceAssetIdentity,
} from "@/shared/invest/contracts/market-price-history";
import {
  MARKET_STATS_VERSION,
  parseMarketStatsResponse,
  type MarketStatsResponse,
} from "@/shared/invest/contracts/market-stats";

type StatsReader = (assetId: string) => Promise<MarketStatsResponse>;
type DynamicAdmissionReader = (address: string, networkId: number) => Promise<boolean>;

export function createMarketStatsHandler(
  readStats: StatsReader = getCodexMarketStats,
  readDynamicAdmission: DynamicAdmissionReader = getInvestHistoryAdmission,
) {
  return async function GET(request: Request) {
    const assetId = new URL(request.url).searchParams.get("assetId") ?? "";
    const identity = resolveMarketPriceAssetIdentity(assetId);
    if (!identity) {
      return Response.json(createUnknownAssetResponse(null), {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (isDynamicMarketPriceAssetId(identity.assetId)) {
      try {
        if (!await readDynamicAdmission(identity.contractAddress, identity.chainId)) {
          return Response.json(createUnknownAssetResponse(identity.assetId), {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        }
      } catch {
        return Response.json(createUnknownAssetResponse(identity.assetId), {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }

    try {
      const raw = await readStats(identity.assetId);
      const response = parseMarketStatsResponse(raw);
      if (!response || response.assetId !== identity.assetId || response.currency !== "USD" ||
        response.provider !== "codex" || response.version !== MARKET_STATS_VERSION) {
        throw new Error("Market stats reader returned mismatched identity");
      }
      if (response.status === "error") {
        return Response.json(createErrorMarketStatsResponse(identity.assetId), {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return Response.json(response, {
        headers: {
          "Cache-Control": response.status === "ready"
            ? "public, max-age=30, stale-while-revalidate=30"
            : "public, max-age=30",
        },
      });
    } catch {
      return Response.json(createErrorMarketStatsResponse(identity.assetId), {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}

function createUnknownAssetResponse(assetId: MarketStatsResponse["assetId"]): MarketStatsResponse {
  return {
    version: MARKET_STATS_VERSION,
    provider: "codex",
    assetId,
    currency: "USD",
    fetchedAt: null,
    status: "unavailable",
    stats: {},
    unavailableReason: "unknown-asset",
  };
}
