import "server-only";

import { investAssets } from "@/config/invest-assets";
import { isRecord } from "@/shared/guards";
import {
  createErrorMarketStatsResponse,
  getCodexMarketStats,
} from "@/server/market-data/codex/market-stats";
import { getInvestHistoryAdmission } from "@/server/market-data/codex/history-admission";
import { getGoPlusTokenRisk } from "@/server/market-data/token-risk/goplus";
import {
  isDynamicMarketPriceAssetId,
  resolveMarketPriceAssetIdentity,
} from "@/shared/invest/contracts/market-price-history";
import {
  MARKET_STATS_VERSION,
  parseMarketStatsResponse,
  type MarketStatsResponse,
  type TokenRisk,
} from "@/shared/invest/contracts/market-stats";

type StatsReader = (assetId: string) => Promise<unknown>;
type DynamicAdmissionReader = (address: string, networkId: number) => Promise<boolean>;
type RiskReader = (identity: { chainId: number; contractAddress: string }) => Promise<unknown>;

const stockIds = new Set<string>(investAssets.filter((asset) => asset.category === "stock").map((asset) => asset.id));

export function createMarketStatsHandler(
  readStats: StatsReader = getCodexMarketStats,
  readDynamicAdmission: DynamicAdmissionReader = getInvestHistoryAdmission,
  readRisk: RiskReader = getGoPlusTokenRisk,
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

    const errorRisk: TokenRisk = {
      source: "goplus",
      chainId: 8453,
      contractAddress: identity.contractAddress.toLowerCase(),
      status: "error",
      checkedAt: null,
    };
    const isStock = stockIds.has(identity.assetId);
    const riskPromise = isStock
      ? Promise.resolve(undefined)
      : Promise.resolve().then(() => readRisk(identity)).catch(() => errorRisk);
    const statsPromise = (async (): Promise<MarketStatsResponse> => {
      try {
        if (isDynamicMarketPriceAssetId(identity.assetId) &&
          !await readDynamicAdmission(identity.contractAddress, identity.chainId)) {
          return createUnknownAssetResponse(identity.assetId);
        }
      } catch {
        return createUnknownAssetResponse(identity.assetId);
      }
      try {
        const raw = await readStats(identity.assetId);
        const response = isRecord(raw) ? parseMarketStatsResponse({ ...raw, risk: undefined }) : null;
        if (!response || response.assetId !== identity.assetId) {
          return createErrorMarketStatsResponse(identity.assetId);
        }
        return response.status === "error" ? createErrorMarketStatsResponse(identity.assetId) : response;
      } catch {
        return createErrorMarketStatsResponse(identity.assetId);
      }
    })();
    const [stats, risk] = await Promise.all([statsPromise, riskPromise]);
    const response = parseMarketStatsResponse({ ...stats, ...(!isStock ? { risk: risk ?? errorRisk } : {}) }) ??
      parseMarketStatsResponse({ ...stats, risk: errorRisk });
    if (!response) throw new Error("Invalid market stats response");
    const retryableRisk = response.risk !== undefined &&
      response.risk.status !== "ready" && response.risk.status !== "unsupported";
    return Response.json(response, {
      headers: {
        "Cache-Control": response.status === "error" || retryableRisk
          ? "no-store"
          : response.status === "ready"
            ? "public, max-age=30, stale-while-revalidate=30"
            : "public, max-age=30",
      },
    });
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
