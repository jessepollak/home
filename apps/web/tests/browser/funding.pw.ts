import { expect, test, type Page, type Route } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { typeAmount } from "./fixtures/type-amount";
import { expectNavigation, NAVIGATION_BUDGET_MS } from "./fixtures/navigation-budget";
import { waitForShellHydration } from "./fixtures/shell-hydration";

test.use({ hasTouch: true });

async function signIn(page: Page) {
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectNavigation(page, /\/home/);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
}

test("IDRX funding reaches payment instructions and receipt", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("home.country.v2", "ID"));
  await installApiFixtures(page);
  const fees = [
    { label: "Provider", amount: "1.50", currency: "USDC" },
    { label: "Network", amount: "100", currency: "IDR" },
    { label: "Gas", amount: "0.1234567", currency: "ETH" },
  ];
  await page.route("**/api/funding/providers?*direction=onramp*", (route) => route.fulfill({ json: {
    version: 3, direction: "onramp", providers: [{
      direction: "onramp", providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx",
      assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR",
      paymentMethods: [{ id: "bank-va-mandiri", label: "Bank transfer · Mandiri" }], quotes: true, customerSetup: null,
    }],
  } }));
  await page.route("**/api/funding/quotes", (route) => route.fulfill({ json: {
    version: 1, quoteToken: "fixture-signed-quote",
    quote: { fiatAmount: "20000", tokenAmountAtomic: "2000000", fees, expiresAt: "2030-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/funding/orders", (route) => route.fulfill({ json: {
    version: 1, order: {
      id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", region: "ID", assetId: "base:idrx",
      paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: "awaiting-payment",
      expectedTokenAmountAtomic: "2000000", fees, providerStatus: "pending",
      instructions: { kind: "bank-transfer", rail: "Mandiri virtual account", accountNumber: "123456789012",
        accountName: "Home Fixture", amount: "20000", currency: "IDR" },
    },
  } }));
  await page.route("**/api/funding/orders/11111111-1111-4111-8111-111111111111", (route) => route.fulfill({ json: {
    version: 1, order: {
      id: "11111111-1111-4111-8111-111111111111", providerId: "idrx", region: "ID", assetId: "base:idrx",
      paymentMethod: "bank-va-mandiri", fiatAmount: "20000", state: "received",
      expectedTokenAmountAtomic: "2000000", fees, providerStatus: "completed", instructions: null,
    },
  } }));
  await signIn(page);
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible({ timeout: NAVIGATION_BUDGET_MS });
  const method = page.getByRole("button", { name: /Deposit IDR/ });
  await expect(method).toContainText("IDRX · Bank transfer · Mandiri");
  await method.click();
  await typeAmount(page, "20000");
  await page.getByRole("button", { name: "Review quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review quote" })).toBeVisible();
  await expect(page.getByText("Deposit", { exact: true }).locator("..")).toContainText("Rp\u00a020.000,00");
  await expect(page.getByText("Receive", { exact: true }).locator("..")).toContainText("Rp\u00a020.000,00");
  await expect(page.getByText("Provider", { exact: true }).locator("..")).toContainText("$1.50");
  await expect(page.getByText("Gas", { exact: true }).locator("..")).toContainText("0.1234 ETH");
  await page.getByRole("button", { name: "Confirm deposit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review payment details" })).toBeVisible();
  await expect(page.getByText("You pay", { exact: true }).locator("..")).toContainText("Rp\u00a020.000,00");
  await expect(page.getByText("Receive", { exact: true }).locator("..")).toContainText("Rp\u00a020.000,00");
  await expect(page.getByText("Network", { exact: true }).locator("..")).toContainText("Rp\u00a0100,00");
  await expect(page.getByText("Provider", { exact: true }).locator("..")).toContainText("$1.50");
  await expect(page.getByText("Gas", { exact: true }).locator("..")).toContainText("0.1234 ETH");
  await page.getByRole("button", { name: "View payment instructions" }).click();
  await expect(page.getByText("123456789012", { exact: true })).toBeVisible();
  await expect(page.getByText("Money received")).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText("Receive", { exact: true }).locator("..")).toContainText("Rp\u00a020.000,00");
  await expect(page.getByText("Provider", { exact: true }).locator("..")).toContainText("$1.50");
});

test("Add money before hydration navigates to the IDRX funding flow", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page, "ID");
  await installApiFixtures(page);
  const { promise: chunksReleased, resolve: releaseChunks } = Promise.withResolvers<void>();
  let heldChunks = 0;
  const holdChunk = async (route: Route) => {
    heldChunks += 1;
    await chunksReleased;
    await route.continue();
  };
  await page.route("**/_next/static/chunks/**/*.js", holdChunk);
  try {
    await page.goto("/home", { waitUntil: "commit" });
    const trigger = page.getByRole("link", { name: "Add money", exact: true });
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeDisabled();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("href", "/home?flow=add-money");
    await expect.poll(() => heldChunks).toBeGreaterThan(0);
    await expect(page.locator("[data-hydrated='true']")).toHaveCount(0);
    await trigger.tap({ noWaitAfter: true });
    await expectNavigation(page, "/home?flow=add-money");
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeDisabled();
    releaseChunks();
    await expect(page.getByRole("dialog", { name: "Add money", exact: true })).toBeVisible({ timeout: NAVIGATION_BUDGET_MS });
    await waitForShellHydration(page);
  } finally {
    releaseChunks();
    await page.unroute("**/_next/static/chunks/**/*.js", holdChunk);
  }
  const method = page.getByRole("button", { name: /Deposit IDR/ });
  await expect(method).toContainText("IDRX · Bank transfer · Mandiri");
  await method.click();
  await expect(page.getByRole("textbox", { name: "Amount" })).toBeVisible();
});
