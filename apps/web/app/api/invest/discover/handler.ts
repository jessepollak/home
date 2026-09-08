import {
  createErrorInvestDiscover,
  getInvestDiscover,
  type InvestDiscoverResponse,
} from "@/server/market-data/invest-discover";

type DiscoverReader = () => Promise<InvestDiscoverResponse>;

export function createInvestDiscoverHandler(
  readDiscover: DiscoverReader = getInvestDiscover,
) {
  return async function GET() {
    try {
      const payload = await readDiscover();
      const cacheControl =
        payload.memes.status === "unavailable"
          ? "public, max-age=30"
          : "public, max-age=45, stale-while-revalidate=45";
      return Response.json(payload, {
        headers: { "Cache-Control": cacheControl },
      });
    } catch {
      return Response.json(createErrorInvestDiscover(), {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}
