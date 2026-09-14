import type { BeforeSendMiddleware } from "@vercel/speed-insights";

const observedRoutes = new Set(["/", "/dashboard"]);

export const filterSpeedInsightsEvent: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    const pathname = url.pathname;
    if (!observedRoutes.has(pathname)) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.search = "";
    url.hash = "";
    return { ...event, url: url.href };
  } catch {
    return null;
  }
};
