import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

test("Cash routes from Home through Savings and restores focus on Back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expect(page).toHaveURL(/\/cash$/);
  await expect(page.getByRole("region", { name: "Cash" })).toBeVisible();
  const savings = page.getByRole("region", { name: "Savings" }).getByRole("button", { name: /^US dollar/ });
  await savings.click();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect(page.getByRole("region", { name: "Savings", exact: true })).toBeVisible();
  const deposit = page.getByRole("button", { name: "Deposit", exact: true });
  await deposit.click();
  await expect(page).toHaveURL(/\/cash\/savings\?flow=save-deposit$/);
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect(deposit).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/cash$/);
  await expect(savings).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test("Cash Add money closes to Cash and one browser Back returns Home", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expect(page).toHaveURL(/\/cash$/);
  const addMoney = page.getByRole("region", { name: "Cash" }).getByRole("button", { name: "Add money" });
  await addMoney.click();
  await expect(page).toHaveURL(/\/cash\?flow=add-money$/);
  await expect(page.getByRole("dialog", { name: "Add money" })).toBeVisible();
  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page).toHaveURL(/\/cash$/);
  await expect(addMoney).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
});

test("Home activity Add money returns focus to its empty-state button", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const to = url.searchParams.get("to") ?? new Date().toISOString();
    return json(route, {
      version: 1,
      walletAddress: sessionBody.smartAccount.address.toLowerCase(),
      chainId: 8453,
      currency: url.searchParams.get("currency") ?? "USD",
      window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to },
      transfers: [], nextCursor: null,
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });
  await page.goto("/home");
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity.getByText("No activity yet")).toBeVisible();
  const addMoney = activity.getByRole("button", { name: "Add money" });
  await addMoney.click();
  await expect(page).toHaveURL(/\/home\?flow=add-money$/);
  await page.getByRole("button", { name: "Close add money" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(addMoney).toBeFocused();
});

test("legacy Save redirects to Savings with the Deposit sheet and refresh preserves view", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const legacyResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/save" && response.status() === 307,
  );
  await page.goto("/save?flow=save-deposit&untrusted=private");
  expect((await legacyResponse).headers().location).toBe("/cash/savings?flow=save-deposit");
  await expect(page).toHaveURL(/\/cash\/savings\?flow=save-deposit$/);
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await page.reload();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect(page.getByRole("region", { name: "Savings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page).toHaveURL(/\/cash\/savings\?flow=save-deposit$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
});
