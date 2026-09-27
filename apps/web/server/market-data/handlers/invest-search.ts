import "server-only";

import { getCodexSearch } from "@/server/market-data/codex/search";
import { parseInvestSearchRequest, INVEST_SEARCH_VERSION, type InvestSearchRequest, type InvestSearchResponse } from "@/shared/invest/contracts/search";

type SearchReader = (request: InvestSearchRequest) => Promise<InvestSearchResponse>;

export function createInvestSearchHandler(readSearch: SearchReader = getCodexSearch) {
  return async function GET(request: Request) {
    const parsed = parseInvestSearchRequest(new URL(request.url).searchParams);
    if (!parsed) return Response.json({ error: "invalid-search" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    try {
      const result = await readSearch(parsed);
      const cacheControl = result.coverage === "complete" && result.provider === "ok"
        ? "public, max-age=30, stale-while-revalidate=30"
        : "no-store";
      return Response.json(result, { headers: { "Cache-Control": cacheControl } });
    } catch {
      return Response.json({ version: INVEST_SEARCH_VERSION, query: parsed.query, offset: parsed.offset, results: [], snapshots: [], provider: "error", coverage: "partial", nextOffset: null } satisfies InvestSearchResponse, { headers: { "Cache-Control": "no-store" } });
    }
  };
}
