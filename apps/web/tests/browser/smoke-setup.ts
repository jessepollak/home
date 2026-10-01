import { request, type FullConfig } from "@playwright/test";
import { homeSessionToken } from "./fixtures/session";

// Compile only cold navigation targets, serially, before browser workers race
// over the dev bundler. This time counts toward the smoke global/job budgets.
export default async function smokeSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  const cookieKey = ["HOME", "PLAYWRIGHT", "ACCESS", "COOKIE"].join("_");
  const accessCookie = process.env[cookieKey];
  if (!baseURL || !accessCookie) throw new Error("Smoke setup requires fixture baseURL and deployment access.");
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      cookie: `${accessCookie}; home-session=${homeSessionToken("0x1111111111111111111111111111111111111111")}`,
    },
  });
  try {
    for (const path of ["/admin/settings/funding", "/borrow", "/cash/savings"]) {
      const started = performance.now();
      const response = await context.get(path, { maxRedirects: 0 });
      if (response.status() !== 200) throw new Error(`Smoke compile ${path}: HTTP ${response.status()}`);
      await response.dispose();
      console.log(`Smoke compile ${path}: ${Math.round(performance.now() - started)}ms`);
    }
  } finally {
    await context.dispose();
  }
}
