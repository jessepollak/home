import "server-only";

import { getCodexSearch } from "@/server/market-data/codex/search";
import { investAssets } from "@/config/invest-assets";
import { readInvestSearchVisibility } from "@/server/operator-settings/invest";
import { isInvestAssetVisible, isInvestCategoryVisible, type InvestSettings } from "@/shared/operator-settings/invest";
import { parseInvestSearchRequest, INVEST_SEARCH_VERSION, INVEST_SEARCH_MAX_CONFIGURED_RESULTS, type InvestSearchRequest, type InvestSearchResponse } from "@/shared/invest/contracts/search";

type SearchReader = (request: InvestSearchRequest) => Promise<InvestSearchResponse>;
const configuredById = new Map<string, (typeof investAssets)[number]>(investAssets.map((asset) => [asset.id, asset]));

function visibleSearchResult(result: InvestSearchResponse["results"][number], settings: InvestSettings): boolean {
  if (result.kind === "dynamic") return isInvestAssetVisible(settings, result.asset);
  const asset = configuredById.get(result.assetId);
  return Boolean(asset && isInvestAssetVisible(settings, asset));
}

export function createInvestSearchHandler(readSearch: SearchReader = getCodexSearch, readVisibility: () => Promise<{ settings: InvestSettings; available: boolean }> = readInvestSearchVisibility) {
  return async function GET(request: Request) {
    const parsed = parseInvestSearchRequest(new URL(request.url).searchParams);
    if (!parsed) return Response.json({ error: "invalid-search" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const { settings, available } = await readVisibility();
      if (!available) {
        return Response.json({ version: INVEST_SEARCH_VERSION, query: parsed.query, offset: parsed.offset, results: [], snapshots: [], provider: "unavailable", coverage: "partial", nextOffset: null } satisfies InvestSearchResponse, { headers: { "Cache-Control": "no-store" } });
      }
      if (parsed.offset > 0 && !isInvestCategoryVisible(settings, "meme")) {
        return Response.json({ version: INVEST_SEARCH_VERSION, query: parsed.query, offset: parsed.offset, results: [], snapshots: [], provider: "skipped", coverage: "complete", nextOffset: null } satisfies InvestSearchResponse, { headers: { "Cache-Control": "no-store" } });
      }
      const result = await readSearch(parsed);
      const visible = result.results.filter((item) => visibleSearchResult(item, settings));
      let configuredCount = 0;
      const results = visible.filter((item) => {
        if (item.kind !== "configured") return true;
        if (configuredCount >= INVEST_SEARCH_MAX_CONFIGURED_RESULTS) return false;
        configuredCount += 1;
        return true;
      });
      const visibleIds = new Set(results.map((item) => item.kind === "dynamic" ? item.asset.id : item.assetId));
      const filtered: InvestSearchResponse = {
        ...result,
        results,
        snapshots: result.snapshots.filter((snapshot) => visibleIds.has(snapshot.assetId)),
        nextOffset: isInvestCategoryVisible(settings, "meme") ? result.nextOffset : null,
      };
      return Response.json(filtered, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ version: INVEST_SEARCH_VERSION, query: parsed.query, offset: parsed.offset, results: [], snapshots: [], provider: "error", coverage: "partial", nextOffset: null } satisfies InvestSearchResponse, { headers: { "Cache-Control": "no-store" } });
    }
  };
}
