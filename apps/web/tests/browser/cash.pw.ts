import { expect, test, type Route } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { buildBalancesSnapshotFixture, ready, priced, pricedCash } from "../../shared/balances/fixtures";
import { CASH_CONVERSION_UNAVAILABLE_REASON, cashConversionCurrencies } from "../../shared/trading/cash-conversion";
import { canonicalUsdcAsset, verifiedLocalCashAssets } from "../../config/portfolio-assets";
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

for (const [mode, title] of [["deposit", "Deposit"], ["withdraw", "Withdraw"]] as const) {
  test(`cold Savings ${mode} focuses Amount after its deferred chunk loads`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const holdChunk = async (route: Route) => {
      await deferred;
      return route.continue();
    };
    await page.route("**/_next/static/chunks/*savings*.js", holdChunk);
    try {
      await page.goto(`/cash/savings?flow=save-${mode}`);
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog.getByText("Loading", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: `Close ${mode} dialog` })).toBeFocused();
      await expect(dialog.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
      release();
      await expect(dialog.getByRole("textbox", { name: "Amount" })).toBeFocused();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await dialog.getByRole("button", { name: `Close ${mode} dialog` }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/cash\/savings$/);
    } finally {
      release();
      await page.unroute("**/_next/static/chunks/*savings*.js", holdChunk);
    }
  });
}

for (const [dismissal, action, title] of [["Back", "Withdraw", "Withdraw"], ["Close", "Deposit more", "Deposit"]] as const) {
  test(`Savings loading ${dismissal} retains focus after a late chunk`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const holdChunk = async (route: Route) => {
      await deferred;
      return route.continue();
    };
    await page.route("**/_next/static/chunks/*savings*.js", holdChunk);
    try {
      await page.goto("/cash/savings");
      const opener = page.getByRole("region", { name: "Your savings" }).getByRole("button", { name: /^Gauntlet USDC Prime/ });
      await opener.click();
      const tray = page.getByRole("dialog", { name: "Gauntlet USDC Prime" });
      const selected = tray.getByRole("button", { name: action });
      await selected.click();
      const loading = page.getByRole("dialog", { name: title, exact: true });
      await expect(loading.getByText("Loading", { exact: true })).toBeVisible();
      await loading.getByRole("button", { name: dismissal === "Back" ? "Back" : "Close deposit dialog", exact: true }).click();
      const retained = dismissal === "Back" ? selected : opener;
      await expect(retained).toBeFocused();
      const chunkLoaded = page.waitForResponse((response) => response.url().includes("/_next/static/chunks/") && response.url().includes("savings") && response.ok());
      release();
      await chunkLoaded;
      await expect(retained).toBeFocused();
      await expect(page.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(dismissal === "Back" ? 1 : 0);
      if (dismissal === "Back") await tray.getByRole("button", { name: "Close Gauntlet USDC Prime details" }).click();
      await expect(opener).toBeFocused();
    } finally {
      release();
      await page.unroute("**/_next/static/chunks/*savings*.js", holdChunk);
    }
  });
}

test("Savings amount Back restores the selected management action after routed history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/cash/savings");
  const opener = page.getByRole("region", { name: "Your savings" }).getByRole("button", { name: /^Gauntlet USDC Prime/ });
  await opener.click();
  const tray = page.getByRole("dialog", { name: "Gauntlet USDC Prime" });
  for (const [action, title, flow] of [["Withdraw", "Withdraw", "save-withdraw"], ["Deposit more", "Deposit", "save-deposit"]] as const) {
    const selected = tray.getByRole("button", { name: action });
    await selected.click();
    await expect(page).toHaveURL(new RegExp(`/cash/savings\\?flow=${flow}$`));
    const amount = page.getByRole("dialog", { name: title });
    await expect(amount.getByRole("textbox", { name: "Amount" })).toBeVisible();
    await amount.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/cash\/savings$/);
    await expect(tray).toBeVisible();
    await expect(selected).toBeFocused();
  }
  await tray.getByRole("button", { name: "Close Gauntlet USDC Prime details" }).click();
  await expect(opener).toBeFocused();
});

test("Savings Account settings Done restores Savings scroll and account focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/cash/savings");
  const savings = page.getByRole("region", { name: "Savings", exact: true });
  await expect(savings).toBeVisible();
  await expect(page.getByRole("region", { name: "Your savings" })).toBeVisible();
  const main = page.locator("main[data-app-main-authenticated]");
  await expect.poll(() => main.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(40);
  await main.evaluate((element) => element.scrollTo({ top: 40, behavior: "auto" }));
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(38);
  const offset = await main.evaluate((element) => element.scrollTop);
  const account = page.getByRole("banner").getByRole("button", { name: "Account" });
  await account.click();
  await expect(page).toHaveURL(/\/cash\/savings\?account=settings$/);
  await expect(page.getByRole("region", { name: "Account settings" })).toBeFocused();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/cash\/savings$/);
  await expect(savings).toBeVisible();
  await expect(account).toBeFocused();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(offset - 2);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(offset + 2);
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
  test(`Cash lists six currencies and guards unavailable Convert destinations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page, { balances: buildBalancesSnapshotFixture({ registry: {
      [canonicalUsdcAsset.id]: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash(canonicalUsdcAsset.cashCurrency, "23400") },
      [verifiedLocalCashAssets.EUR.id]: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash(verifiedLocalCashAssets.EUR.cashCurrency, "1500") },
      [verifiedLocalCashAssets.IDR.id]: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash(verifiedLocalCashAssets.IDR.cashCurrency, "190000000") },
      [verifiedLocalCashAssets.ARS.id]: { balance: ready("123450000000000000000"), value: priced("USD", "12000"), cashValue: pricedCash(verifiedLocalCashAssets.ARS.cashCurrency, "12345") },
      [verifiedLocalCashAssets.BRL.id]: { balance: ready("23450000000000000000"), value: priced("USD", "5000"), cashValue: pricedCash(verifiedLocalCashAssets.BRL.cashCurrency, "2345") },
      [verifiedLocalCashAssets.COP.id]: { balance: ready("1234560000000000000000"), value: priced("USD", "3000"), cashValue: pricedCash(verifiedLocalCashAssets.COP.cashCurrency, "123456") },
    } }) });
    const unavailableIds = new Set(cashConversionCurrencies.filter((currency) => !currency.convertOffered).map((currency) => currency.tradeAssetId));
    const tradeRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/trades") tradeRequests.push(url.searchParams.get("assetId") ?? "");
      if (url.pathname === "/api/actions/prepare" && request.method() === "POST") {
        const body = request.postDataJSON() as { kind?: string; params?: { assetId?: string } };
        if (body.kind === "trade") tradeRequests.push(body.params?.assetId ?? "");
      }
    });
    await page.goto("/home");
    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
    const currencies = page.getByRole("region", { name: "Currencies" });
    for (const name of ["US dollar", "Euro", "Rupiah", "Argentine peso", "Brazilian real", "Colombian peso"]) {
      await expect(currencies.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(currencies.getByRole("listitem")).toHaveCount(6);
    await page.getByRole("region", { name: "Cash", exact: true }).getByRole("button", { name: "Convert" }).click();
    const picker = page.getByRole("dialog", { name: "Convert to" });
    await expect(picker.getByRole("listitem")).toHaveCount(5);
    for (const name of ["Euro", "Rupiah", "Argentine peso", "Brazilian real", "Colombian peso"]) await expect(picker.getByText(name)).toBeVisible();
    await expect(picker.getByText("US dollar")).toHaveCount(0);
    await picker.getByRole("textbox", { name: "Search currencies" }).fill("wbrl");
    await expect(picker.getByRole("listitem")).toHaveCount(1);
    await expect(picker.getByText("Brazilian real")).toBeVisible();
    await picker.getByRole("button", { name: "Clear search" }).click();
    await expect(picker.getByRole("listitem")).toHaveCount(5);
    for (const name of ["Argentine peso", "Brazilian real", "Colombian peso"]) {
      const row = picker.getByText(name).locator("xpath=ancestor::li");
      await expect(row).toContainText(CASH_CONVERSION_UNAVAILABLE_REASON);
      await expect(row.getByRole("button")).toHaveCount(0);
    }
    await picker.getByText("Argentine peso").click();
    await expect(picker).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
    await picker.getByRole("button", { name: "Close conversion" }).click();
    await currencies.getByRole("button", { name: /^Argentine peso/ }).click();
    const detail = page.getByRole("dialog", { name: "Argentine peso" });
    await expect(detail).toContainText("$123.45");
    await expect(detail).toContainText(CASH_CONVERSION_UNAVAILABLE_REASON);
    await expect(detail.getByRole("button", { name: "Convert" })).toHaveCount(0);
    expect(tradeRequests.filter((id) => unavailableIds.has(id))).toEqual([]);
  });
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

test("Cash Convert keeps the last currency reachable above a simulated mobile keyboard", async ({ page }) => {
  const viewportHeight = 844;
  const keyboardInset = 300;
  const viewportTop = 100;
  await page.setViewportSize({ width: 390, height: viewportHeight });
  await seedSignedInSession(page);
  await installApiFixtures(page, { balances: buildBalancesSnapshotFixture({ registry: {
    [canonicalUsdcAsset.id]: { balance: ready("234000000"), value: priced("USD", "23400"), cashValue: pricedCash(canonicalUsdcAsset.cashCurrency, "23400") },
    [verifiedLocalCashAssets.EUR.id]: { balance: ready("15000000"), value: priced("USD", "1700"), cashValue: pricedCash(verifiedLocalCashAssets.EUR.cashCurrency, "1500") },
    [verifiedLocalCashAssets.IDR.id]: { balance: ready("190000000"), value: priced("USD", "11700"), cashValue: pricedCash(verifiedLocalCashAssets.IDR.cashCurrency, "190000000") },
    [verifiedLocalCashAssets.ARS.id]: { balance: ready("123450000000000000000"), value: priced("USD", "12000"), cashValue: pricedCash(verifiedLocalCashAssets.ARS.cashCurrency, "12345") },
    [verifiedLocalCashAssets.BRL.id]: { balance: ready("23450000000000000000"), value: priced("USD", "5000"), cashValue: pricedCash(verifiedLocalCashAssets.BRL.cashCurrency, "2345") },
    [verifiedLocalCashAssets.COP.id]: { balance: ready("1234560000000000000000"), value: priced("USD", "3000"), cashValue: pricedCash(verifiedLocalCashAssets.COP.cashCurrency, "123456") },
  } }) });
  await page.goto("/home");
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await page.getByRole("region", { name: "Cash", exact: true }).getByRole("button", { name: "Convert" }).click();
  const picker = page.getByRole("dialog", { name: "Convert to" });
  const body = page.locator("[data-slot=drawer-popup] [data-slot=money-modal-body]");
  const search = picker.getByRole("textbox", { name: "Search currencies" });
  const lastRow = picker.getByText("Colombian peso").locator("xpath=ancestor::li");
  await expect(picker.getByRole("listitem")).toHaveCount(5);
  const drawerViewport = page.locator("[data-slot=drawer-viewport]");
  await drawerViewport.evaluate((element, frame) => {
    element.style.setProperty("--sheet-keyboard-inset", `${frame.inset}px`);
    element.style.setProperty("--sheet-keyboard-top", `${frame.top}px`);
  }, { inset: keyboardInset, top: viewportTop });
  try {
    await expect.poll(async () => (await picker.boundingBox())?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(viewportTop);
    await expect.poll(async () => {
      const box = await picker.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(viewportHeight - keyboardInset);
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    const bodyBox = await body.boundingBox();
    expect(searchBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();
    expect(searchBox!.y).toBeGreaterThanOrEqual(bodyBox!.y);
    expect(searchBox!.y + searchBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
    await expect.poll(async () => {
      const listBox = await picker.getByRole("list").boundingBox();
      const visibleBody = await body.boundingBox();
      return listBox && visibleBody ? listBox.height - visibleBody.height : Number.NEGATIVE_INFINITY;
    }).toBeGreaterThan(0);
    expect.soft(await body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => {
      const row = await lastRow.boundingBox();
      const visibleBody = await body.boundingBox();
      return row && visibleBody ? Math.min(visibleBody.y + visibleBody.height, viewportHeight - keyboardInset) - (row.y + row.height) : Number.NEGATIVE_INFINITY;
    }).toBeGreaterThanOrEqual(0);
    const rowBox = await lastRow.boundingBox();
    const visibleBody = await body.boundingBox();
    expect(rowBox!.y).toBeGreaterThanOrEqual(Math.max(visibleBody!.y, viewportTop));
    await expect(lastRow).toContainText(CASH_CONVERSION_UNAVAILABLE_REASON);
  } finally {
    await drawerViewport.evaluate((element) => {
      element.style.removeProperty("--sheet-keyboard-inset");
      element.style.removeProperty("--sheet-keyboard-top");
    });
  }
});
