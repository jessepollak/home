import { expect, test, type Page } from "@playwright/test";
import { activityOrdersFixture, marketPricesFixture } from "./feature-map/fixtures";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { borrowOverviewBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";

/** Hosted CI runners cold-compile each route in dev; give overlay assertions a CI-sized budget. */
test.describe.configure({ timeout: 90_000 });

const pages = ["/home", "/activity", "/cash", "/cash/savings", "/investments", "/borrow", "/invest"] as const;

test("legacy Balances paths redirect to canonical pages without unrelated query keys", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  for (const [source, target] of [
    ["/balances", "/cash"], ["/balances/cash", "/cash"],
    ["/balances/investments", "/investments"], ["/balances/unrecognized", "/home"],
    ["/balances/cash/extra", "/home"],
  ]) {
    await page.goto(`${source}?flow=send&account=settings&untrusted=private`);
    await expect.poll(() => {
      const url = new URL(page.url());
      return `${url.pathname}${url.search}`;
    }).toBe(`${target}?flow=send&account=settings`);
  }
});

for (const path of pages) {
  test(`${path} renders inside the shell and opens the Send overlay`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(`${path}?flow=send`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Close send dialog" }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("dialog", { name: "Send" })).toHaveCount(0);
  });
}

test("manual-production: warm Home, Cash and Invest taps avoid document and RSC requests", async ({ page }) => {
  test.skip(process.env.HOME_PLAYWRIGHT_PRODUCTION !== "1",
    "manual-production: Next dev refetches RSC payloads; run with HOME_PLAYWRIGHT_PRODUCTION=1 against a production fixture build");
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash / }).click();
  await expect(page).toHaveURL("/cash");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true }).last().click();
  await expect(page).toHaveURL("/invest");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).last().click();
  await expect(page).toHaveURL("/home");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() || request.headers()["rsc"] === "1") requests.push(request.url());
  });
  for (const target of ["Invest", "Home"] as const) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: target, exact: true }).last().click();
    await expect(page).toHaveURL(target === "Home" ? "/home" : "/invest");
  }
  expect(requests).toEqual([]);
});

test("a left Savings page makes no vault requests while hidden for two fake minutes", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/cash/savings");
  await expect(page.getByRole("region", { name: "Savings", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your savings" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true }).last().click();
  await expect(page).toHaveURL("/invest");
  await page.clock.install();
  let vaultReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/savings/vaults") vaultReads += 1;
  });
  await page.clock.runFor(120_000);
  expect(vaultReads).toBe(0);
});

const mainNavigation = (page: Page, name: string) => page.getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name, exact: true }).last();

function countRequests(page: Page, pathname: string) {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === pathname) counter.count += 1;
  });
  return counter;
}

for (const [path, ready] of [
  ["/home", (page: Page) => page.getByRole("heading", { name: "Your money" })],
  ["/activity", (page: Page) => page.locator("[data-app-main-authenticated]").getByRole("region", { name: "Activity" }).last()],
] as const) {
  test(`a left ${path} page stops polling pending orders while hidden for two fake minutes`, async ({ page }) => {
    await page.clock.install();
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/activity/orders", (route) => json(route, activityOrdersFixture()));
    await page.goto(path);
    await expect(ready(page)).toBeVisible();
    const orders = countRequests(page, "/api/activity/orders");
    await page.clock.runFor(60_000);
    await expect.poll(() => orders.count).toBeGreaterThan(0);
    await mainNavigation(page, "Invest").click();
    await expect(page).toHaveURL("/invest");
    orders.count = 0;
    await page.clock.runFor(120_000);
    expect(orders.count).toBe(0);
  });
}

test("a left Investments page stops rechecking market prices while hidden", async ({ page }) => {
  await page.clock.install();
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/market-prices", (route) => json(route, marketPricesFixture()));
  await page.goto("/investments");
  await expect(page.getByRole("region", { name: "Your investments" })).toBeVisible();
  const prices = countRequests(page, "/api/market-prices");
  await page.clock.runFor(600_000);
  await expect.poll(() => prices.count).toBeGreaterThan(0);
  await mainNavigation(page, "Home").click();
  await expect(page).toHaveURL("/home");
  prices.count = 0;
  await page.clock.runFor(600_000);
  expect(prices.count).toBe(0);
});

test("a hidden holding detail keeps its own route and chart range across Home and Back", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/investments/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Bitcoin");
  const ranges = page.getByRole("group", { name: "Price range" });
  await ranges.getByRole("button", { name: "1M", exact: true }).click();
  await expect(ranges.getByRole("button", { name: "1M", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ranges.evaluate((element) => { element.setAttribute("data-mount-probe", "kept"); });
  await mainNavigation(page, "Home").click();
  await expect(page).toHaveURL("/home");
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
  await expect(page.locator("[data-mount-probe=kept]")).toHaveCount(1);
  await expect(page.locator("[data-holding-key]")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/investments\/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf$/i);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Bitcoin");
  await expect(page.locator("[data-mount-probe=kept]")).toBeVisible();
  await expect(ranges.getByRole("button", { name: "1M", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Activity transaction detail returns after visiting its owned Bitcoin holding", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const bitcoin = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const to = url.searchParams.get("to") ?? new Date(FIXED_NOW).toISOString();
    const wallet = "0x1111111111111111111111111111111111111111";
    return json(route, {
      version: 1, walletAddress: wallet, chainId: 8453, currency: "USD",
      window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to },
      transfers: [{
        id: `8453:${bitcoin}:received-fixture`, logId: "received-fixture", chainId: 8453,
        assetId: "cbbtc", tokenAddress: bitcoin, tokenSymbol: "cbBTC", tokenDecimals: 8,
        tokenImageUrl: null, walletAddress: wallet,
        fromAddress: "0x2222222222222222222222222222222222222222", toAddress: wallet,
        direction: "incoming", amountBaseUnits: "10000000", blockNumber: "1",
        blockHash: `0x${"ab".repeat(32)}`, transactionHash: `0x${"cd".repeat(32)}`,
        logIndex: "1", blockTimestamp: new Date(Date.parse(to) - 60_000).toISOString(),
        valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      }],
      nextCursor: null, source: { provider: "cdp-sql", cached: false, stale: false,
        executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  await page.goto("/activity");
  await page.getByRole("button", { name: /Received.*cbBTC/ }).first().click();
  const detail = page.getByRole("dialog", { name: "Received" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Bitcoin Asset" }).click();
  await expect(page).toHaveURL(`/investments/${bitcoin}`);
  await page.goBack();
  await expect(page).toHaveURL("/activity");
  await expect(page.getByRole("dialog", { name: "Received" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Received" })).toContainText("cbBTC");
});

test("settled signed-out fixture cannot access a shell page", async ({ page }) => {
  await installApiFixtures(page);
  await page.goto("/cash");
  await expect(page).toHaveURL(/\/\?account=signin$/);
  await expect(page.getByRole("dialog", { name: "Sign in to Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cash" })).toHaveCount(0);
});

for (const path of pages) {
  for (const [query, dialogName, closeName] of [
    ["flow=add-money", "Add money", "Close add money"],
    ["flow=receive", "Receive", "Close add money"],
    ["flow=send&action=11111111-1111-4111-8111-111111111111", "Send", "Close send dialog"],
  ] as const) {
    test(`${path} opens and closes ${query}`, async ({ page }) => {
      await seedSignedInSession(page);
      await installApiFixtures(page);
      await page.goto(`${path}?${query}`, { waitUntil: "domcontentloaded" });
      const dialog = page.getByRole("dialog", { name: dialogName });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.getByRole("button", { name: closeName }).click();
      await expect(page).toHaveURL(path);
      await expect(dialog).toHaveCount(0);
    });
  }
  test(`${path} opens and closes Account settings`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(`${path}?account=settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Account settings" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("region", { name: "Account settings" })).toHaveCount(0);
  });
}

for (const [flow, dialogName, closeName] of [
  ["save-deposit", "Deposit", "Close deposit dialog"],
  ["save-withdraw", "Withdraw", "Close withdraw dialog"],
] as const) {
  test(`Cash Savings ${flow} stays local and closes`, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(`/cash/savings?flow=${flow}`, { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog", { name: dialogName });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: closeName }).click();
    await expect(page).toHaveURL("/cash/savings");
  });
}

test("shell Back reuses the existing entry through browser Back and Forward", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash / }).click();
  await expect(page).toHaveURL("/cash");
  await page.goBack();
  await expect(page).toHaveURL("/home");
  await page.goForward();
  await expect(page).toHaveURL("/cash");
  const entries = await page.evaluate(() => window.history.length);
  await page.getByRole("banner").getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL("/home");
  expect(await page.evaluate(() => window.history.length)).toBe(entries);
});

test("closing a deep-linked Borrow market reuses the overview history entry", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const overview = borrowOverviewBody();
  const available = overview.opportunities.flatMap((entry) => entry.availability.status === "available" ? [entry.availability] : []);
  const target = available[0];
  expect(target).toBeTruthy();
  const marketId = target!.snapshot.market.id;
  await page.route(/\/api\/borrow/, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    return json(route, pathname === "/api/borrow" ? overview : target!.snapshot);
  });
  await page.goto(`/borrow/${marketId}`);
  const dialog = page.getByRole("dialog", { name: "Borrow" });
  const back = page.getByRole("button", { name: "Back to Borrow" });
  await expect(dialog.or(back)).toBeVisible();
  const entries = await page.evaluate(() => window.history.length);
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close Borrow action" }).click();
  else await back.click();
  await expect(page).toHaveURL("/borrow");
  expect(await page.evaluate(() => window.history.length)).toBe(entries);
});

test("browser Back between pages records one history navigation sample", async ({ page }) => {
  const reports: { kind?: string; route?: string; from?: string; trigger?: string }[] = [];
  await page.addInitScript(() => {
    let seed = 1;
    Math.random = () => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * 0.2; };
  });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route((url) => url.pathname === "/api/client-performance", async (route) => {
    reports.push(route.request().postDataJSON() as (typeof reports)[number]);
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expect(page).toHaveURL(/\/cash$/);
  await expect.poll(() => reports.filter((report) => report.kind === "home-navigation").length).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => reports.filter((report) => report.kind === "home-navigation")
    .map(({ route, from, trigger }) => `${from}>${route}:${trigger}`)).toEqual(["/home>/cash:in-app", "/cash>/home:history"]);
});
