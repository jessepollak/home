import { expect, test, type Route } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { buildBalancesSnapshotFixture, ready, priced, pricedCash } from "../../shared/balances/fixtures";
import { cashConversionCurrencies } from "../../shared/trading/cash-conversion";
import { preparedConversionFixture } from "./feature-map/conversion-fixture";

test("warm Cash and Home paint with deferred API reads and restore Home scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const wallet = sessionBody.smartAccount.address.toLowerCase();
  const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  await page.route("**/api/activity*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/activity") return route.fallback();
    const to = url.searchParams.get("to") ?? new Date(FIXED_NOW).toISOString();
    const cursor = url.searchParams.get("cursor");
    const minutes = cursor === "older" ? [13, 14, 15, 16] : Array.from({ length: 12 }, (_, index) => index + 1);
    return json(route, {
      version: 1,
      walletAddress: wallet,
      chainId: 8453,
      currency: url.searchParams.get("currency") ?? "USD",
      window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to },
      transfers: minutes.map((minute) => ({
        id: `8453:${token}:cash-nav-${minute}`,
        logId: `cash-nav-${minute}`,
        chainId: 8453,
        assetId: "usdc",
        tokenAddress: token,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        tokenImageUrl: null,
        walletAddress: wallet,
        fromAddress: "0x2222222222222222222222222222222222222222",
        toAddress: wallet,
        direction: "incoming",
        amountBaseUnits: "25000000",
        blockNumber: String(1000 - minute),
        blockHash: `0x${"ef".repeat(32)}`,
        transactionHash: `0x${minute.toString(16).padStart(64, "0")}`,
        logIndex: "1",
        blockTimestamp: new Date(Date.parse(to) - minute * 60_000).toISOString(),
        valuation: { status: "unpriced", currency: "USD", reason: "quote-unavailable" },
      })),
      nextCursor: cursor === "older" ? null : "older",
      source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
    });
  });

  const money = page.getByRole("region", { name: "Your money" });
  const cashRow = money.getByRole("button", { name: /^Cash/ });
  const activity = page.getByRole("region", { name: "Activity" });
  const rows = activity.locator("ul > li");
  const cash = page.getByRole("region", { name: "Cash", exact: true });
  const balance = page.getByLabel("Cash balance");
  const main = page.locator("main[data-app-main-authenticated]");
  const back = page.locator("[data-shell-back] button");
  await page.goto("/home");
  await expect(money).toBeVisible();
  await expect(activity).not.toHaveAttribute("aria-busy", "true");
  await expect(rows.first()).toBeVisible();
  await cashRow.click();
  await expect(page).toHaveURL(/\/cash$/);
  await expect(balance).toContainText(/\$[\d,.]+/);
  await back.click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(rows.first()).toBeVisible();

  await main.hover();
  await page.mouse.wheel(0, 60);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const offset = await page.evaluate(() => window.scrollY);
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  const holdApi = async (route: Route) => {
    if (new URL(route.request().url()).pathname === "/api/session") return route.fallback();
    await deferred;
    return route.fallback();
  };
  await page.route("**/api/**", holdApi);
  try {
    const expectHomeRestored = async () => {
      await expect(page).toHaveURL(/\/home$/);
      await expect(money).toBeVisible();
      await expect(activity).not.toHaveAttribute("aria-busy", "true");
      await expect(rows.first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThanOrEqual(offset - 2);
      await expect.poll(() => page.evaluate(() => window.scrollY))
        .toBeLessThanOrEqual(offset + 2);
    };
    const expectCashPainted = async () => {
      await expect(page).toHaveURL(/\/cash$/);
      await expect(cash).toBeVisible();
      await expect(balance).toContainText(/\$[\d,.]+/);
      await expect(balance).not.toHaveAttribute("aria-busy", "true");
      await expect(balance.locator("[data-shimmer]")).toHaveCount(0);
    };

    await cashRow.click();
    await expectCashPainted();
    await back.click();
    await expectHomeRestored();
    await cashRow.click();
    await expectCashPainted();
    await page.goBack();
    await expectHomeRestored();
  } finally {
    await page.unroute("**/api/**", holdApi);
    release();
  }
});

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
  const opener = page.getByRole("region", { name: "Your savings" }).getByRole("button", { name: /^Gauntlet USDC Prime/ });
  await expect(opener).toHaveAccessibleDescription("Manage Gauntlet USDC Prime");
  await opener.click();
  const tray = page.getByRole("dialog", { name: "Gauntlet USDC Prime" });
  await expect(tray).toBeVisible();
  await tray.getByRole("button", { name: "Deposit more" }).click();
  await expect(page).toHaveURL(/\/cash\/savings\?flow=save-deposit$/);
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Close deposit dialog" }).click();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect(opener).toBeFocused();
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
    const to = url.searchParams.get("to") ?? new Date(FIXED_NOW).toISOString();
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
  const held = page.getByRole("region", { name: "Your savings" }).getByRole("button", { name: /^Gauntlet USDC Prime/ });
  await expect(held).toHaveAccessibleDescription("Manage Gauntlet USDC Prime");
  await held.click();
  await page.getByRole("dialog", { name: "Gauntlet USDC Prime" }).getByRole("button", { name: "Deposit more" }).click();
  await expect(page).toHaveURL(/\/cash\/savings\?flow=save-deposit$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Deposit" })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`Cash Convert opens EUR review and EUR row detail in one sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page, { balances: buildBalancesSnapshotFixture({ registry: {
      usdc: { balance: ready("12340000"), value: priced("USD", "1234"), cashValue: pricedCash("USD", "1234") },
      eurc: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash("EUR", "1500") },
    } }) });
    const euro = cashConversionCurrencies.find((currency) => currency.code === "EUR")!;
    await page.route("**/api/trades?*", (route) => {
      const assetId = new URL(route.request().url()).searchParams.get("assetId");
      if (assetId !== euro.tradeAssetId) return route.fallback();
      return json(route, { version: 2, status: "available", token: { assetId, address: euro.address, symbol: euro.symbol, decimals: euro.decimals }, buy: "available", balanceBaseUnits: "15000000" });
    });
    const prepared: Array<{ direction: string; amountBaseUnits: string; assetId: string }> = [];
    await page.route("**/api/actions/prepare", (route) => {
      const body = route.request().postDataJSON() as { kind: string; params: { direction: "buy" | "sell"; amountBaseUnits: string; assetId: string } };
      if (body.kind !== "trade") return route.fallback();
      const { direction, amountBaseUnits, assetId } = body.params;
      prepared.push({ direction, amountBaseUnits, assetId });
      return json(route, preparedConversionFixture({ direction, amountBaseUnits, assetId }));
    });
    await page.goto("/home");
    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
    const convert = page.getByRole("region", { name: "Cash", exact: true }).getByRole("button", { name: "Convert", exact: true });
    await expect(convert).toBeVisible();
    await convert.click();
    const picker = page.getByRole("dialog", { name: "Convert to" });
    await expect(picker.getByRole("button", { name: /^US dollar/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /^Euro/ }).click();
    const amount = page.getByRole("dialog", { name: "Convert to Euro" });
    await amount.getByRole("textbox", { name: "Amount" }).fill("1.25");
    await amount.getByRole("button", { name: "Continue" }).click();
    const review = page.getByRole("dialog", { name: "Confirm" });
    await expect(review.getByText("You pay")).toBeVisible();
    await expect(review.getByText("You receive")).toBeVisible();
    expect(prepared).toEqual([{ direction: "buy", assetId: euro.tradeAssetId, amountBaseUnits: "1250000" }]);
    await review.getByRole("button", { name: "Close conversion" }).click();
    await expect(convert).toBeFocused();
    const euroRow = page.getByRole("region", { name: "Currencies" }).getByRole("button", { name: /^Euro/ });
    await euroRow.click();
    const detail = page.getByRole("dialog", { name: "Euro" });
    await expect(detail).toContainText("€15.00");
    await detail.getByRole("button", { name: "Convert", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Convert to US dollar" }).getByRole("textbox", { name: "Amount" })).toBeVisible();
    await page.getByRole("button", { name: "Close conversion" }).click();
    await expect(euroRow).toBeFocused();
  });
}
