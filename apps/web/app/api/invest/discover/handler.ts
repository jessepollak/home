import {
  createErrorInvestDiscover,
  getInvestDiscover,
  type InvestDiscoverResponse,
} from "@/server/market-data/invest-discover";

type DiscoverReader = (offset: number) => Promise<InvestDiscoverResponse>;

export function createInvestDiscoverHandler(
  readDiscover: DiscoverReader = getInvestDiscover,
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const offset = readOffsetParam(url.searchParams.get("offset"));
    if (offset === null) {
      return Response.json(
        { error: "invalid-offset" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const payload = await readDiscover(offset);
      // Failures must never be cached as successful/exhausted pages.
      const cacheControl =
        payload.memes.status === "ready" || payload.memes.status === "empty"
          ? "public, max-age=45, stale-while-revalidate=45"
          : payload.memes.status === "unavailable"
            ? "public, max-age=30"
            : "no-store";
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

function readOffsetParam(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
