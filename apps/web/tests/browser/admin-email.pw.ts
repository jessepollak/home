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

test("an unavailable email account check recovers through Try again", { tag: "@smoke" }, async ({ page, context, baseURL }) => {
  const minted = await signInWithEmail(page, context, baseURL, operatorSession, "operator");
  let unavailable = true;
  await page.route("**/api/session", (route) => route.fulfill({
    status: unavailable ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify(unavailable ? { error: { code: "SESSION_UNAVAILABLE" } } : sessionBody),
  }));

  await page.goto("/admin");
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't check Admin access." })).toBeVisible();
  expect(minted).toHaveLength(0);
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  expect(minted).toHaveLength(1);
});

test("an email operator with a valid grant loads Admin without a refresh and renews the grant after five minutes, not ten", { tag: "@smoke" }, async ({ page, context, baseURL }) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const minted = await signInWithEmail(page, context, baseURL, operatorSession, "operator");
  const serverNow = Date.parse((await context.request.get("/api/admin/session")).headers().date ?? "");
  await context.addCookies([{ ...operatorGrantCookie(operatorSession, serverNow), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  const refreshes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/admin") && request.headers().rsc === "1") refreshes.push(request.url()); });
  let settled = 0;
  page.on("response", (response) => { if (response.request().method() === "POST" && response.url().endsWith("/api/admin/session")) settled += 1; });
  await page.clock.install();
  await page.goto("/admin");
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => settled).toBe(1);
  await page.clock.runFor(1_000);
  const afterLoad = refreshes.length;
  let advanced = 0;
  await expect.poll(async () => {
    await page.clock.runFor(30_000);
    advanced += 30_000;
    return minted.length;
  }, { timeout: 30_000 }).toBe(2);
  expect(advanced).toBeLessThanOrEqual(6 * 60_000);
  await expect.poll(() => settled).toBe(2);
  await page.clock.runFor(1_000);
  expect(refreshes.length).toBe(afterLoad);
});

test("a granted Admin page refreshes when the live email session resolves to a different operator", { tag: "@smoke" }, async ({ page, context, baseURL }) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("Playwright baseURL is required");
  const otherOperator = { user: { subject: "playwright-other-operator" }, smartAccount: { address: "0x3333333333333333333333333333333333333333", chainId: 8453 } };
  await signInWithEmail(page, context, baseURL, operatorSession, "operator");
  const serverNow = Date.parse((await context.request.get("/api/admin/session")).headers().date ?? "");
  await context.addCookies([{ ...operatorGrantCookie(operatorSession, serverNow), url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  await page.route("**/api/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...sessionBody, ...otherOperator }) }));
  let releaseMint: () => void = () => {};
  const mintReleased = new Promise<void>((resolve) => { releaseMint = resolve; });
  await page.route("**/api/admin/session", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await mintReleased;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, operator: { address: otherOperator.smartAccount.address } }) });
  });
  const refreshes: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/admin") && request.headers().rsc === "1") refreshes.push(request.url()); });
  await page.goto("/admin");
  await expect(page.locator("[data-operator-ready=true]")).toBeVisible({ timeout: 15_000 });
  const beforeMint = refreshes.length;
  releaseMint();
  await expect.poll(() => refreshes.length).toBeGreaterThan(beforeMint);
});

test("an email customer who is not an operator lands on Home without Admin content", { tag: "@smoke" }, async ({ page, context, baseURL }) => {
  const minted = await signInWithEmail(page, context, baseURL, customerSession, "forbidden");
  await page.goto("/admin");
  await page.waitForURL(/\/home/, { timeout: 15_000 });
  expect(minted).toHaveLength(0);
  await expect(page.getByRole("navigation", { name: "Operator sections" })).toHaveCount(0);
});
