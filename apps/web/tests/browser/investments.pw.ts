import { expect, test, type Page } from "@playwright/test";
import { manyOwnedInvestmentsSnapshot } from "./fixtures/balances";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

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
  await expect(page).toHaveURL(/\/investments$/);
  await expect(title(page)).toHaveText("Investments");
  await expect(page.getByLabel("Investments balance").getByRole("img")).toHaveAttribute("aria-label", rowValue!);
}

async function expectBitcoinDetail(page: Page) {
  await expect(page).toHaveURL(holdingUrl);
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
  await expect(page).toHaveURL(/\/investments$/);
  await expect(bitcoin(page)).toBeFocused();

  await bitcoin(page).click();
  await expectBitcoinDetail(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(bitcoin(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
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
  await expect(page).toHaveURL(/\/investments$/);
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
  const scrollBefore = await page.locator("[data-app-main-authenticated]").evaluate((main) => main.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);
  await row.click();
  await expect(page).toHaveURL(/\/investments\/0x[0-9a-f]{40}$/);
  await expect(title(page)).toHaveText("Extra investment 45");
  await page.goBack();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(row).toBeFocused();
  await expect.poll(() => row.evaluate((button) => {
    const main = button.closest("[data-app-main-authenticated]");
    if (!main) return false;
    const item = button.getBoundingClientRect();
    const viewport = main.getBoundingClientRect();
    return main.scrollTop > 0 && item.top >= viewport.top && item.bottom <= viewport.bottom;
  })).toBe(true);
});

test("Invest tab opens discovery, not owned holdings", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(homeInvestments(page)).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
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
  await expect(page).toHaveURL(/\/investments$/);
  const row = page.getByRole("region", { name: "Your investments" }).getByRole("button", { name: /^Extra investment 45 / });
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport();
});
