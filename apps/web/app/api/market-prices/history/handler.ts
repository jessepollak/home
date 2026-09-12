import {
  createErrorMarketHistoryResponse,
  getCodexMarketHistory,
} from "@/server/market-data/codex/history";
import {
  isDynamicMarketPriceAssetId,
  isMarketPriceRange,
  resolveMarketPriceAssetIdentity,
  type MarketPriceHistoryResponse,
  type MarketPriceRange,
} from "@/shared/invest/history-contract";
import { getCodexTrendingMemeAdmission } from "@/server/market-data/codex/trending";

type HistoryReader = (
  assetId: string,
  range: string,
) => Promise<MarketPriceHistoryResponse>;
type DynamicAdmissionReader = (
  contractAddress: string,
  networkId: number,
) => Promise<boolean>;

export function createMarketPriceHistoryHandler(
  readHistory: HistoryReader = getCodexMarketHistory,
  readDynamicAdmission: DynamicAdmissionReader = getCodexTrendingMemeAdmission,
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
        // Provider-backed exact admission from the canonical contract/network.
        // This is independent of the page-zero catalog so page-2+ memes pass.
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
      const payload = await readHistory(identity.assetId, range);
      if (
        payload.assetId !== identity.assetId ||
        payload.range !== range ||
        payload.currency !== "USD"
      ) {
        throw new Error("History reader returned mismatched identity");
      }
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
      return Response.json(createErrorMarketHistoryResponse(identity.assetId, range), {
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
    currency: "USD",
    fetchedAt: null,
    status: "unavailable",
    points: [],
    unavailableReason,
  };
}
