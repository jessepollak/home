import { chromium, type FullConfig } from "@playwright/test";
import { homeSessionToken } from "./fixtures/session";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Admin smoke warm-up requires a baseURL.");

  const playwrightCookieKey = ["HOME", "PLAYWRIGHT", "ACCESS", "COOKIE"].join("_");
  const accessCookie = process.env[playwrightCookieKey];
  if (!accessCookie) throw new Error("Admin smoke warm-up requires HOME_PLAYWRIGHT_ACCESS_COOKIE.");

  const accessToken = /^home-access=([^;]+)$/.exec(accessCookie)?.[1];
  if (!accessToken) throw new Error("Admin smoke warm-up requires a home-access cookie.");
  const apiRoutesAdminSmokeFirstVisits = [
    "/api/admin/session",
    "/api/auth/base/logout",
    "/api/access/logout",
  ];

  const browser = await chromium.launch({ ...config.projects[0]?.use.launchOptions, headless: true });
  try {
    const context = await browser.newContext({ baseURL });
    const cookie = (name: string, value: string) => ({
      name, value, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" as const,
    });
    await context.addCookies([
      cookie("home-access", accessToken),
      cookie("home-session", homeSessionToken("0x1111111111111111111111111111111111111111")),
    ]);
    for (const path of apiRoutesAdminSmokeFirstVisits) {
      try {
        const response = await context.request.get(path, { maxRedirects: 0 });
        if (response.status() >= 500) throw new Error(`HTTP ${response.status()}`);
      } catch (error) {
        throw new Error(`Admin smoke warm-up failed for ${path}: ${String(error)}`, { cause: error });
      }
    }
    const page = await context.newPage();
    const routesAdminSmokeFirstVisits = [
      "/admin", "/admin/customers", "/admin/support", "/admin/growth", "/admin/money",
      "/admin/settings", "/admin/audit", "/admin/nope", "/admin/customers/x/y",
    ];
    const visit = async (path: string) => {
      try {
        const response = await page.goto(path);
        if (response && response.status() >= 500) throw new Error(`HTTP ${response.status()}`);
      } catch (error) {
        throw new Error(`Admin smoke warm-up failed for ${path}: ${String(error)}`, { cause: error });
      }
    };
    for (const path of routesAdminSmokeFirstVisits) await visit(path);
    await context.addCookies([cookie("home-session", homeSessionToken("0x2222222222222222222222222222222222222222"))]);
    await visit("/admin/nope");
    await context.clearCookies();
    await context.addCookies([cookie("home-access", accessToken)]);
    await visit("/?account=signin");
    await context.clearCookies();
    await visit("/access?next=%2Fadmin");
  } finally {
    await browser.close();
  }
}
