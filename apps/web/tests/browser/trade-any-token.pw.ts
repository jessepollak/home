import { expect, test, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { degenAssetId, syntheticDegen, tradePrepareFixture } from "./feature-map/fixtures";

async function warmTradeStep(page: Page, label: "Buy" | "Sell") {
  // The deferred trade step is fetched on idle; warm it so the measured taps render the loaded sheet.
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Amount" })).toBeVisible({ timeout: process.env.CI ? 15_000 : 5_000 });
  await page.getByRole("button", { name: "Close trade dialog" }).click();
  await expect(page.locator("[data-money-sheet]")).toHaveCount(0);
}

async function tapAndExpectAmountFocus(page: Page, label: "Buy" | "Sell") {
  await page.evaluate((label) => {
    const state = window as Window & { tradeTapFocus?: string };
    state.tradeTapFocus = "waiting";
    let started = false;
    const finish = (result: "focused" | "interrupted") => {
      state.tradeTapFocus = result;
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", interrupt, true);
      window.removeEventListener("keydown", interrupt, true);
      document.removeEventListener("focusin", record, true);
    };
    const interrupt = () => finish("interrupted");
    const record = () => {
      if (document.activeElement?.matches('[data-money-sheet] [data-money-amount-input][aria-label="Amount"]')) finish("focused");
    };
    const onClick = (event: MouseEvent) => {
      if (started) return interrupt();
      if (!(event.target instanceof Element) || event.target.closest("button")?.textContent?.trim() !== label) return;
      started = true;
      state.tradeTapFocus = "pending";
      window.addEventListener("pointerdown", interrupt, true);
      window.addEventListener("keydown", interrupt, true);
      document.addEventListener("focusin", record, true);
      record();
    };
    window.addEventListener("click", onClick, true);
  }, label);
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Amount" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as Window & { tradeTapFocus?: string }).tradeTapFocus)).toBe("focused");
}

test("exact Base address has an identity and can review partial and full DEGEN sells", { tag: "@smoke" }, async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const requests: Array<{ version: number; amountBaseUnits: string; assetId: string; direction: string }> = [];
  await page.route("**/api/trades?**", (route) => json(route, {
    version: 2, status: "available", token: { assetId: degenAssetId, address: syntheticDegen, symbol: "DEGEN", decimals: 18 },
    buy: "available", balanceBaseUnits: "123000000000000000000",
  }));
  await page.route("**/api/actions/prepare", (route) => {
    const body = route.request().postDataJSON() as { params: { version: number; amountBaseUnits: string; assetId: string; direction: "buy" | "sell" } };
    requests.push(body.params);
    return json(route, tradePrepareFixture(body.params.direction, "degen", body.params.amountBaseUnits === "all"));
  });
  await page.goto(`/invest/${degenAssetId}`);
  await expect(page.getByText("DEGEN", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Base", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Asset unavailable")).toHaveCount(0);
  await expect(page.getByText("Price history")).toHaveCount(0);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("0.5");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("You get")).toBeVisible();
  await expect(page.getByText("Network fee")).toBeVisible();
  await expect(page.getByText("Minimum received")).toHaveCount(0);
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Minimum received")).toBeVisible();
  expect(requests.at(-1)).toEqual({ version: 3, assetId: degenAssetId, direction: "sell", amountBaseUnits: "500000000000000000" });
  await page.getByRole("button", { name: "Close trade dialog" }).click();
  await expect(page.locator("[data-money-sheet]")).toHaveCount(0);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sell DEGEN" })).toBeVisible();
  await page.getByRole("button", { name: "Max" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("You get")).toBeVisible();
  await expect(page.getByText("Minimum received")).toHaveCount(0);
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Minimum received")).toBeVisible();
  expect(requests.at(-1)).toEqual({ version: 3, assetId: degenAssetId, direction: "sell", amountBaseUnits: "all" });
});

test("Buy and Sell focus Amount during the tap at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/trades?**", (route) => json(route, {
    version: 2, status: "available", token: { assetId: degenAssetId, address: syntheticDegen, symbol: "DEGEN", decimals: 18 },
    buy: "available", balanceBaseUnits: "123000000000000000000",
  }));
  await page.goto(`/invest/${degenAssetId}`);
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toBeEnabled();
  await warmTradeStep(page, "Buy");
  for (const label of ["Buy", "Sell"] as const) {
    await tapAndExpectAmountFocus(page, label);
    await page.getByRole("button", { name: "Close trade dialog" }).click();
    await expect(page.locator("[data-money-sheet]")).toHaveCount(0);
  }
});

test("long token header keeps the selector, truncated title and close control separate at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const symbol = "EXTREMELYLONGTOK";
  await page.route("**/api/trades?**", (route) => json(route, {
    version: 2, status: "available", token: { assetId: degenAssetId, address: syntheticDegen, symbol, decimals: 18 },
    buy: "available", balanceBaseUnits: "123000000000000000000",
  }));
  await page.goto(`/invest/${degenAssetId}`);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Sell ${symbol}` });
  const header = dialog.locator('[data-slot="drawer-header"]');
  const selector = header.getByRole("group", { name: symbol });
  const title = header.getByText(`Sell ${symbol}`);
  const close = header.getByRole("button", { name: "Close trade dialog" });
  await expect(selector).toBeVisible();
  await expect(title).toBeVisible();
  await expect(close).toBeVisible();
  const [selectorBox, titleBox, closeBox] = await Promise.all([selector.boundingBox(), title.boundingBox(), close.boundingBox()]);
  expect(selectorBox && titleBox && closeBox).toBeTruthy();
  expect(selectorBox!.x).toBeGreaterThanOrEqual(0);
  expect(selectorBox!.x + selectorBox!.width).toBeLessThanOrEqual(titleBox!.x + 0.5);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(closeBox!.x + 0.5);
  expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(320);
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test("buy-blocked availability still allows a DEGEN sell", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/trades?**", (route) => json(route, {
    version: 2, status: "available", token: { assetId: degenAssetId, address: syntheticDegen, symbol: "DEGEN", decimals: 18 },
    buy: "blocked", balanceBaseUnits: "123000000000000000000",
  }));
  await page.goto(`/invest/${degenAssetId}`);
  await expect(page.getByText("Buying is unavailable. You can still sell or send.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toBeEnabled();
  await warmTradeStep(page, "Sell");
  await tapAndExpectAmountFocus(page, "Sell");
});
