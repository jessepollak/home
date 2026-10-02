import { expect, test, type Locator, type Page } from "@playwright/test";
import { portfolioVaults } from "../../config/portfolio-assets";
import { seedSignedInSession, installApiFixtures } from "./fixtures/api";
import { savingsVaultsBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { savingsFixtureActionIds } from "./feature-map/savings-fixture";

function reviewRow(page: Page, dialog: Locator, label: string) {
  return dialog.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }) }).locator("dd");
}

for (const operation of ["deposit", "withdraw"] as const) {
  test(`savings ${operation} shows the verified prepared review`, { tag: operation === "deposit" ? "@smoke" : [] }, async ({ page }) => {
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto(`/cash/savings?flow=save-${operation}`);
    const dialog = page.getByRole("dialog").filter({ visible: true });
    await dialog.getByRole("textbox", { name: "Amount" }).fill("0.1");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Confirm" })).toBeVisible();
    const from = reviewRow(page, dialog, "From").getByRole("button");
    await expect(from).toHaveAttribute("title", "0x1111111111111111111111111111111111111111");
    await expect(from).toHaveText("0x1111…111111");
    await expect(reviewRow(page, dialog, "Vault")).toHaveText("Gauntlet USDC Prime");
    await expect(reviewRow(page, dialog, "Network")).toHaveText("Base (8453)");
    await expect(reviewRow(page, dialog, "Rate")).toHaveText("3.50% APY at last update");
    await expect(reviewRow(page, dialog, "Vault fee")).toHaveText("10.00%");
    await expect(reviewRow(page, dialog, "Amount")).toHaveText("$0.10");
    await expect(reviewRow(page, dialog, "Network fee")).toHaveText("Up to 0.02 USDC · ≈ $0.02");
    await expect(dialog.getByRole("button", { name: `${operation === "deposit" ? "Deposit" : "Withdraw"} $0.10` }))
      .toHaveAttribute("data-money-action-id", savingsFixtureActionIds[operation]);
  });
}

test("savings deposit forwards a selected second vault and non-default amount to prepared review", async ({ page }) => {
  const secondVault = portfolioVaults[1];
  if (!secondVault) throw new Error("The savings fixture needs a second configured vault.");
  expect(secondVault.address).not.toBe(portfolioVaults[0]?.address);
  const now = new Date(FIXED_NOW).toISOString();
  const vaults = savingsVaultsBody(now, now);
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/savings/vaults", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ...vaults,
      candidates: [...vaults.candidates, {
        ...vaults.candidates[0],
        vaultAddress: secondVault.address,
        name: secondVault.name,
        symbol: secondVault.symbol,
      }],
    }),
  }));
  await page.goto("/cash/savings");
  await page.getByRole("region", { name: "More ways to save" })
    .getByRole("button").filter({ hasText: secondVault.name }).click();
  const dialog = page.getByRole("dialog").filter({ visible: true });
  await expect(dialog.getByRole("heading", { name: "Deposit" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Amount" }).fill("2.25");
  const prepareResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/actions/prepare" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Continue" }).click();
  const response = await prepareResponse;
  expect(response.request().postDataJSON()).toEqual({
    kind: "savings-deposit",
    params: { kind: "deposit", vaultAddress: secondVault.address, amountBaseUnits: "2250000" },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    id: savingsFixtureActionIds.deposit,
    kind: "savings-deposit",
    metadata: { vaultAddress: secondVault.address },
  });
  await expect(dialog.getByRole("heading", { name: "Confirm" })).toBeVisible();
  await expect(reviewRow(page, dialog, "Vault")).toHaveText(secondVault.name);
  await expect(reviewRow(page, dialog, "Amount")).toHaveText("$2.25");
  await expect(dialog.getByRole("button", { name: "Deposit $2.25" }))
    .toHaveAttribute("data-money-action-id", savingsFixtureActionIds.deposit);
});
