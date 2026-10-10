import { expect, test, type Page } from "@playwright/test";
import { manyOwnedInvestmentsSnapshot } from "./fixtures/balances";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { expectNavigation } from "./fixtures/navigation-budget";
import { heldRiskSnapshot, installRiskMarketFixtures, tokenRiskStatsFixture } from "./fixtures/token-risk";
import { degenAssetId, syntheticDegen } from "./feature-map/fixtures";

const title = (page: Page) => page.locator("[data-shell-header-title]").first();
const homeInvestments = (page: Page) => page.getByRole("region", { name: "Your money" })
  .getByRole("button", { name: /^Investments/ });
const bitcoin = (page: Page) => page.getByRole("region", { name: "Your investments" })
  .getByRole("button", { name: /^Bitcoin / });
const holdingUrl = /\/investments\/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf$/i;

async function openHoldings(page: Page) {
  await page.goto("/home");
  const row = homeInvestments(page);
  await expect(row).toBeVisible();
  const rowValue = await row.getByRole("img").getAttribute("aria-label");
  expect(rowValue).toBeTruthy();
  await row.click();
  await expectNavigation(page, /\/investments$/);
  await expect(title(page)).toHaveText("Investments");
  await expect(page.getByLabel("Investments balance").getByRole("img")).toHaveAttribute("aria-label", rowValue!);
}

async function expectBitcoinDetail(page: Page) {
  await expectNavigation(page, holdingUrl);
  await expect(title(page)).toHaveText("Bitcoin");
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toBeVisible();
}

test("Home holdings, detail history and header Back restore focus", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await openHoldings(page);

  await bitcoin(page).click();
  await expectBitcoinDetail(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/investments$/);
  await expect(bitcoin(page)).toBeFocused();

  await bitcoin(page).click();
  await expectBitcoinDetail(page);
  await page.goBack();
  await expectNavigation(page, /\/investments$/);
  await expect(bitcoin(page)).toBeFocused();
  await page.goBack();
  await expectNavigation(page, /\/home$/);
  await expect(homeInvestments(page)).toBeVisible();
});

test("refreshed holding detail returns to the list without leaving Home", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/investments/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
  await expectBitcoinDetail(page);
  await page.reload();
  await expectBitcoinDetail(page);
  const historyLength = await page.evaluate(() => window.history.length);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/investments$/);
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  await expect(bitcoin(page)).toBeFocused();
  await expect(page.getByRole("region", { name: "Your investments" })).toBeVisible();
});

test("browser Back restores focus and viewport for a holding beyond row forty", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 440 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: manyOwnedInvestmentsSnapshot() });
  await page.goto("/investments");
  const list = page.getByRole("region", { name: "Your investments" });
  await expect(list.getByRole("button")).toHaveCount(20);
  await list.getByRole("button").last().scrollIntoViewIfNeeded();
  await expect(list.getByRole("button")).toHaveCount(40);
  await list.getByRole("button").last().scrollIntoViewIfNeeded();
  await expect(list.getByRole("button")).toHaveCount(51);
  const row = list.getByRole("button", { name: /^Extra investment 45 / });
  await row.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  await row.click();
  await expectNavigation(page, /\/investments\/0x[0-9a-f]{40}$/);
  await expect(title(page)).toHaveText("Extra investment 45");
  await page.goBack();
  await expectNavigation(page, /\/investments$/);
  await expect(row).toBeFocused();
  await expect.poll(() => row.evaluate((button) => {
    const item = button.getBoundingClientRect();
    return window.scrollY > 0 && item.top >= 0 && item.bottom <= window.innerHeight;
  })).toBe(true);
});

test("Invest tab opens discovery, not owned holdings", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(homeInvestments(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Invest", exact: true }).click();
  await expectNavigation(page, /\/invest$/);
  await expect(title(page)).toHaveText("Invest");
  for (const shelf of ["Stocks", "Crypto", "Memes"]) {
    await expect(page.getByRole("region", { name: shelf })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Your investments" })).toHaveCount(0);
});

test("cold deep link beyond the first batch reveals and focuses its row on Back", async ({ page }) => {
  await seedSignedInSession(page);
  const snapshot = manyOwnedInvestmentsSnapshot();
  await installApiFixtures(page, { balances: snapshot });
  const holding = snapshot.holdings.find((entry) => entry.name === "Extra investment 45");
  if (!holding?.contractAddress) throw new Error("Missing deep-link fixture holding");
  await page.goto(`/investments/${holding.contractAddress}`);
  await expect(title(page)).toHaveText("Extra investment 45");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/investments$/);
  const row = page.getByRole("region", { name: "Your investments" }).getByRole("button", { name: /^Extra investment 45 / });
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
});

test("a refreshed large investment list keeps its scroll geometry while selection is pending", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 440 });
  await seedSignedInSession(page);
  const snapshot = manyOwnedInvestmentsSnapshot(997);
  let changed = false;
  let changedReads = 0;
  await installApiFixtures(page, { balances: snapshot });
  await page.route("**/api/balances?*", (route) => {
    if (changed) changedReads++;
    return route.fulfill({ json: changed ? { ...snapshot, fetchedAt: new Date(Date.parse(snapshot.fetchedAt) + 1000).toISOString() } : snapshot });
  });
  await page.goto("/investments");
  const list = page.getByRole("region", { name: "Your investments" });
  await expect(list.getByRole("button")).toHaveCount(20);
  await list.getByRole("button").last().scrollIntoViewIfNeeded();
  await expect(list.getByRole("button")).toHaveCount(40);
  await list.getByRole("button").nth(30).scrollIntoViewIfNeeded();
  const focusedRow = list.getByRole("button").nth(30);
  const focusedKey = await focusedRow.locator("[data-holding-key]").getAttribute("data-holding-key");
  await focusedRow.focus();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  const refreshSamples = await page.evaluateHandle(() => {
    const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
    if (!main) throw new Error("Missing Home scroll container");
    const samples: { busy: boolean; scroll: number }[] = [];
    new MutationObserver(() => {
      const section = main.querySelector('[aria-labelledby="investments-held-heading"]');
      samples.push({ busy: section?.getAttribute("aria-busy") === "true", scroll: window.scrollY });
    }).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    return samples;
  });
  await page.clock.install();
  changed = true;
  await page.clock.fastForward(16_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => changedReads).toBeGreaterThan(0);
  await expect.poll(() => refreshSamples.evaluate((samples) =>
    samples.some((entry) => entry.busy) && samples.at(-1)?.busy === false,
  )).toBe(true);
  const pendingScrolls = await refreshSamples.evaluate((samples) => samples.filter((entry) => entry.busy).map((entry) => entry.scroll));
  expect(pendingScrolls.length).toBeGreaterThan(0);
  for (const scroll of pendingScrolls) expect(scroll).toBeCloseTo(before, 0);
  await expect(list.getByRole("button").filter({ has: page.locator(`[data-holding-key="${focusedKey}"]`) })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
  await refreshSamples.dispose();
});

test("held honeypot advisory preserves owned-token Sell entry and Back focus", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: heldRiskSnapshot() });
  await installRiskMarketFixtures(page);
  await page.route("**/api/market-prices/stats?*", (route) => json(route,
    tokenRiskStatsFixture(degenAssetId, { honeypot: "reported", sellTax: { state: "reported", fraction: { atoms: "1", scale: 0 } } }, "unavailable")));
  await page.route("**/api/trades?*", (route) => json(route, {
    version: 2, status: "available", token: { assetId: degenAssetId, address: syntheticDegen, symbol: "DEGEN", decimals: 18 },
    buy: "available", balanceBaseUnits: "123000000000000000000",
  }));
  const confirms: string[] = [];
  await page.route("**/api/actions/*/confirm", (route) => { confirms.push(route.request().url()); return route.abort(); });
  await openHoldings(page);
  const row = page.getByRole("region", { name: "Your investments" }).getByRole("button", { name: /^DEGEN / });
  await row.click(); await expectNavigation(page, new RegExp(`/investments/${syntheticDegen}$`));
  await expect(title(page)).toHaveText("DEGEN");
  const checks = page.getByRole("region", { name: "Token checks" });
  const trigger = checks.getByRole("button", { name: /Token checks/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toBeEnabled();
  await trigger.click();
  await expect(checks.getByText("May not be sellable", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Token checks" }).getByText("Sell tax 100%", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Token checks" }).getByText("GoPlus reports a 100% sell tax", { exact: true })).toBeVisible();
  await expect(page.getByText("123 DEGEN", { exact: true })).toBeVisible();
  const sell = page.getByRole("button", { name: "Sell", exact: true });
  await expect(sell).toBeEnabled(); await sell.click();
  const dialog = page.getByRole("dialog", { name: "Sell DEGEN", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Amount", exact: true }).fill("0.5");
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Max", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close trade dialog" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/investments$/); await expect(row).toBeFocused();
  expect(confirms).toEqual([]);
});
