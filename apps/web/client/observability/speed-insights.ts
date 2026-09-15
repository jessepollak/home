import type { BeforeSendMiddleware } from "@vercel/speed-insights";
import { normalizeHomeStartupRoute } from "@/shared/observability/client-performance.contract";

export const filterSpeedInsightsEvent: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Dynamic L2 paths normalize to their low-cardinality L1 page label on
    // both `url` and `route`, so no asset/market segment can leak through
    // either field.
    const route = normalizeHomeStartupRoute(url.pathname);
    if (!route) return null;
    // Vercel rejects pathname-only metric `href` values as invalid HTTP URLs,
    // so the sanitized value must remain absolute.
    return { ...event, url: new URL(route, url.origin).href, route };
  } catch {
    return null;
  }
};
