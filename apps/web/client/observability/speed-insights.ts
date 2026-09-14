import type { BeforeSendMiddleware } from "@vercel/speed-insights";

const observedRoutes = new Set(["/", "/dashboard"]);

export const filterSpeedInsightsEvent: BeforeSendMiddleware = (event) => {
  try {
    const pathname = new URL(event.url, "https://home.invalid").pathname;
    if (!observedRoutes.has(pathname)) return null;
    return { ...event, url: pathname, route: pathname };
  } catch {
    return null;
  }
};
