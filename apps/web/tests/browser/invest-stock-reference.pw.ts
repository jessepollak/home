import { expect, test } from "@playwright/test";
import { balancesSnapshot } from "./fixtures/balances";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { marketPricesFixture, priceHistoryFixture } from "./feature-map/fixtures";
import { isMarketPriceRange } from "../../shared/invest/contracts/market-price-history";

for (const width of [390, 1280]) {
  test(`stock detail reconciles reference header, sampled scrub and holding at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await seedSignedInSession(page);
    await installApiFixtures(page, { balances: balancesSnapshot("US", { stocks: true }) });
    await page.route("**/api/market-prices", (route) => json(route, marketPricesFixture()));
    let releaseYear = () => {};
    const year = new Promise<void>((resolve) => { releaseYear = resolve; });
    const requests: string[] = [];
    await page.route("**/api/market-prices/history?**", async (route) => {
      const url = new URL(route.request().url());
      const range = url.searchParams.get("range");
      if (!range || !isMarketPriceRange(range)) throw new Error("Invalid history fixture range");
      requests.push(range);
      if (range === "1Y") await year;
      return json(route, priceHistoryFixture(url.searchParams.get("assetId") ?? "", undefined, range));
    });
    try {
      await page.goto("/invest/nvdac");
      await expect(page.locator("[data-shell-header-title]").first()).toHaveText("NVIDIA");
      const price = page.locator("strong[data-tone]");
      await expect(price).toContainText("$180.24");
      const chart = page.getByRole("group", { name: /^1 week price history/ });
      await expect(chart).toBeVisible();
      await expect(page.getByText(/DEX market price/)).toHaveCount(0);
      const source = page.getByText(/^Chainlink reference price · Last observed/);
      await expect(source).toBeVisible();
      await expect(page.getByText(/Sampled reference prices/)).toBeVisible();
      await expect(page.getByText(/Closing prices|Market cap/)).toHaveCount(0);
      const chartBox = await chart.boundingBox();
      const rangeBox = await page.getByRole("group", { name: "Price range", exact: true }).boundingBox();
      const sourceBox = await source.boundingBox();
      if (!chartBox || !rangeBox || !sourceBox) throw new Error("Missing stock detail bounding boxes");
      expect(rangeBox.y - chartBox.y - chartBox.height).toBeGreaterThanOrEqual(0);
      expect(rangeBox.y - chartBox.y - chartBox.height).toBeLessThanOrEqual(16);
      expect(sourceBox.y).toBeGreaterThanOrEqual(rangeBox.y + rangeBox.height);
      await expect(page.getByText("0.5 NVDAc", { exact: true })).toBeVisible();
      await expect(page.getByText("$90.12", { exact: true })).toBeVisible();
      await chart.focus();
      await page.keyboard.press("End");
      await expect(price).toContainText("$180.24");
      await expect(page.locator("[data-scrub-readout]")).toBeVisible();
      await page.keyboard.press("Home");
      await expect(price).toContainText("$170.00");
      await page.keyboard.press("Escape");
      await expect(price).toContainText("$180.24");
      expect(requests).toEqual(["1W"]);
      await page.getByRole("button", { name: "1D", exact: true }).click();
      await page.getByRole("button", { name: "1Y", exact: true }).click();
      await page.getByRole("button", { name: "1W", exact: true }).click();
      await expect(chart).toBeVisible();
      releaseYear();
      await expect.poll(() => requests).toEqual(["1W", "1D", "1Y"]);
      await expect(page.locator('[data-layer-range="1Y"][data-layer-state="shown"]')).toHaveCount(0);
      await chart.focus();
      await page.keyboard.press("End");
      await expect(price).toContainText("$180.24");
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error("Missing chart bounding box");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    } finally { releaseYear(); }
  });
}
