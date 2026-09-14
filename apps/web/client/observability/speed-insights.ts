import type { BeforeSendMiddleware } from "@vercel/speed-insights";

const observedRoutes = new Set(["/", "/dashboard"]);

export const filterSpeedInsightsEvent: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    const pathname = url.pathname;
    if (!observedRoutes.has(pathname)) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const sanitizedUrl = new URL(pathname, url.origin);
    return { ...event, url: sanitizedUrl.href };
  } catch {
    return null;
  }
};
