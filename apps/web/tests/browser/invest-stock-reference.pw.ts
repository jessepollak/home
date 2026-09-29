import { expect, test } from "@playwright/test";
import { balancesSnapshot } from "./fixtures/balances";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { marketPricesFixture, priceHistoryFixture } from "./feature-map/fixtures";

test("stock detail keeps the last-close reference above the DEX market caption and chart at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: balancesSnapshot("US", { stocks: true }) });
  await page.route("**/api/market-prices", (route) => json(route, marketPricesFixture()));
  await page.route("**/api/market-prices/history?**", (route) => {
    const url = new URL(route.request().url());
    return url.searchParams.get("range") === "1W"
      ? json(route, priceHistoryFixture(url.searchParams.get("assetId") ?? ""))
      : route.fallback();
  });
  await page.goto("/invest/nvdac");

  const header = page.locator("[data-shell-header-title]").first();
  await expect(header).toHaveText("NVIDIA");
  const price = page.locator("strong[data-tone]");
  await expect(price).toHaveAttribute("data-tone", "ready");
  await expect(price).toContainText("$180.24");
  const context = page.getByText("Last close", { exact: true }).first();
  const caption = page.getByText(/^DEX market price/);
  const chart = page.getByRole("group", { name: /^1 week price history, \d+ points$/ });
  await expect(context).toBeVisible();
  await expect(caption).toBeVisible();
  await expect(chart).toBeVisible();

  const [headerBox, priceBox, contextBox, captionBox, chartBox] = await Promise.all(
    [header, price, context, caption, chart].map(async (locator) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      return box!;
    }),
  );
  const bottom = (box: typeof headerBox) => box.y + box.height;
  expect(priceBox.y).toBeGreaterThanOrEqual(bottom(headerBox));
  expect(contextBox.y).toBeGreaterThanOrEqual(bottom(priceBox) - 1);
  expect(captionBox.y).toBeGreaterThanOrEqual(bottom(contextBox));
  expect(chartBox.y).toBeGreaterThanOrEqual(bottom(captionBox));
  for (const box of [priceBox, contextBox, captionBox, chartBox]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});
