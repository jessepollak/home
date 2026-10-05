import "server-only";

import {
  createErrorMarketHistoryResponse,
  getCodexMarketHistory,
} from "@/server/market-data/codex/history";
import { getTokenizedEquityHistory } from "@/server/market-data/tokenized-equity/history";
import { getInvestHistoryAdmission } from "@/server/market-data/codex/history-admission";
import {
  expectedMarketPriceHistorySource,
  parseHistoryResponse,
  isDynamicMarketPriceAssetId,
  isMarketPriceRange,
  MARKET_HISTORY_PRIORITY_HEADER,
  MARKET_PRICE_HISTORY_VERSION,
  resolveMarketPriceAssetIdentity,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/contracts/market-price-history";

type HistoryReader = (
  assetId: string,
  range: string,
  options?: { speculative?: boolean },
) => Promise<MarketPriceHistoryResponse>;
type DynamicAdmissionReader = (
  contractAddress: string,
  networkId: number,
) => Promise<boolean>;

export function createMarketPriceHistoryHandler(
  readHistory: HistoryReader = getCodexMarketHistory,
  readDynamicAdmission: DynamicAdmissionReader = getInvestHistoryAdmission,
  readStockHistory: HistoryReader = getTokenizedEquityHistory,
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId") ?? "";
    const range = url.searchParams.get("range") ?? "";
    const identity = resolveMarketPriceAssetIdentity(assetId);
    const knownRange = isMarketPriceRange(range);

    if (!identity || !knownRange) {
      return Response.json(
        createUnavailableQueryResponse(
          identity?.assetId ?? null,
          knownRange ? range : null,
          identity ? "invalid-range" : "unknown-asset",
        ),
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (isDynamicMarketPriceAssetId(identity.assetId)) {
      try {
        const admitted = await readDynamicAdmission(
          identity.contractAddress,
          identity.chainId,
        );
        if (!admitted) {
          return Response.json(
            createUnavailableQueryResponse(
              identity.assetId,
              range,
              "unknown-asset",
            ),
            {
              status: 404,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }
      } catch {
        return Response.json(
          createUnavailableQueryResponse(
            identity.assetId,
            range,
            "unknown-asset",
          ),
          {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
    }

    try {
      const reader = expectedMarketPriceHistorySource(identity.assetId)?.kind === "tokenized-equity-feed" ? readStockHistory : readHistory;
      const payload = await reader(identity.assetId, range, {
        speculative: request.headers.get(MARKET_HISTORY_PRIORITY_HEADER) === "prefetch",
      });
      if (
        !parseHistoryResponse(payload) ||
        payload.assetId !== identity.assetId ||
        payload.range !== range ||
        payload.currency !== "USD"
      ) {
        throw new Error("History reader returned mismatched identity");
      }
      if (payload.status === "error") return Response.json(payload, { status: 502, headers: { "Cache-Control": "no-store" } });
      if (payload.unavailableReason === "overloaded") {
        return Response.json(payload, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
      const cacheControl = payload.unavailableReason
        ? "public, max-age=30"
        : "public, max-age=30, stale-while-revalidate=30";
      return Response.json(payload, {
        headers: { "Cache-Control": cacheControl },
      });
    } catch {
      return Response.json(createErrorMarketHistoryResponse(identity.assetId, range) satisfies MarketPriceHistoryResponse, {
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
    version: MARKET_PRICE_HISTORY_VERSION,
    provider: assetId && expectedMarketPriceHistorySource(assetId)?.kind === "tokenized-equity-feed" ? "chainlink" : "codex",
    source: assetId ? expectedMarketPriceHistorySource(assetId) : null,
    assetId,
    range,
    currency: "USD",
    fetchedAt: null,
    status: "unavailable",
    points: [],
    unavailableReason,
  };
}
