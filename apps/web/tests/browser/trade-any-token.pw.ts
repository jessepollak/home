import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { degenAssetId, syntheticDegen, tradePrepareFixture } from "./feature-map/fixtures";

test("exact Base address has an identity and can review partial and full DEGEN sells", async ({ page }) => {
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
  expect(requests.at(-1)).toEqual({ version: 2, assetId: degenAssetId, direction: "sell", amountBaseUnits: "500000000000000000" });
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
  expect(requests.at(-1)).toEqual({ version: 2, assetId: degenAssetId, direction: "sell", amountBaseUnits: "all" });
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
});
