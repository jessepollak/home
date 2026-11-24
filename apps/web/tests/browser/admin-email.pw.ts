import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionBody } from "./fixtures/bodies";
import { seedSignedInSession } from "./fixtures/api";
import { cdpRenderSessionCookies, operatorGrantCookie } from "./fixtures/session";

const operatorSession = { user: sessionBody.user, smartAccount: sessionBody.smartAccount, accountProvider: "cdp-embedded" as const };
const customerSession = { ...operatorSession, user: { subject: "playwright-email-customer" }, smartAccount: { address: "0x2222222222222222222222222222222222222222", chainId: 8453 } };

async function signInWithEmail(page: Page, context: BrowserContext, baseURL: string | undefined, session: typeof operatorSession, grant: "operator" | "forbidden") {
  if (!baseURL) throw new Error("Playwright baseURL is required");
  await context.addCookies(cdpRenderSessionCookies(session).map((cookie) => ({ ...cookie, url: baseURL })));
  await seedSignedInSession(page);
  await page.route("**/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...sessionBody, user: session.user, smartAccount: session.smartAccount }) }));
  const minted: string[] = [];
  await page.route("**/api/admin/session", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    minted.push(route.request().headers().authorization ?? "");
    if (grant === "forbidden") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "OPERATOR_FORBIDDEN" } }) });
    const serverNow = Date.parse((await context.request.get("/api/admin/session")).headers().date ?? "");
    if (!Number.isFinite(serverNow)) throw new Error("server Date header is required");
    await context.addCookies([{ ...operatorGrantCookie(session, serverNow), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, operator: { address: session.smartAccount.address } }) });
  });
  return minted;
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`an allowlisted email operator opens Admin at ${viewport.width}`, { tag: "@smoke" }, async ({ page, context, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const minted = await signInWithEmail(page, context, baseURL, operatorSession, "operator");

    const hinted = await context.request.get("/admin");
    expect(await hinted.text()).not.toContain("Operator sections");

    await page.goto("/admin");
    await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    expect(minted[0]).toBe("Bearer playwright-smoke-token");

    const api = await context.request.get("/api/admin/session");
    expect(await api.json()).toEqual({ version: 1, operator: { address: operatorSession.smartAccount.address } });

    await context.clearCookies({ name: "home-cdp-live" });
    expect((await context.request.get("/api/admin/session")).status()).toBe(401);
  });
}

test("an email customer who is not an operator lands on Home without Admin content", { tag: "@smoke" }, async ({ page, context, baseURL }) => {
  const minted = await signInWithEmail(page, context, baseURL, customerSession, "forbidden");
  await page.goto("/admin");
  await page.waitForURL(/\/home/, { timeout: 15_000 });
  expect(minted).toHaveLength(1);
  await expect(page.getByRole("navigation", { name: "Operator sections" })).toHaveCount(0);
});
