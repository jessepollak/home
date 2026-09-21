import type { BeforeSendMiddleware } from "@vercel/speed-insights";
import { normalizeHomeStartupRoute } from "@/shared/observability/client-performance.contract";

export const filterSpeedInsightsEvent: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const route = normalizeHomeStartupRoute(url.pathname);
    if (!route) return null;
    return { ...event, url: new URL(route, url.origin).href, route };
  } catch {
    return null;
  }
};
