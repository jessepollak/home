import { expect, test, type Page } from "@playwright/test";
import { isRegionId, presentationRegions, type CountryCode, type FiatCurrencyCode, type RegionId } from "@/config/regions";
import { COUNTRY_PREFERENCE_VERSION, parseCountryPreferenceRequest } from "@/shared/account/contracts/country-preference";
import { isOfferedDisplayCurrency, type DisplayCurrencyChoice } from "@/shared/account/display-currency";
import { buildBalancesSnapshotFixture, priced, pricedCash, ready, requiredLocalCashAsset } from "@/shared/balances/fixtures";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { marketPricesFixture } from "./feature-map/fixtures";
import { expectNavigation } from "./fixtures/navigation-budget";

function preferenceStore(displayCurrency: DisplayCurrencyChoice | null = null) {
  let saved: { version: typeof COUNTRY_PREFERENCE_VERSION; regionId: CountryCode | null; displayCurrency: DisplayCurrencyChoice | null } = { version: COUNTRY_PREFERENCE_VERSION, regionId: "BR", displayCurrency };
  let failWrites = false;
  let releaseRead = () => {};
  let heldRead: Promise<void> | null = null;
  return {
    failWrites(value: boolean) { failWrites = value; },
    holdRead() { heldRead = new Promise<void>((resolve) => { releaseRead = resolve; }); },
    releaseRead() { releaseRead(); heldRead = null; },
    async install(page: Page) {
      await page.route("**/api/account/country-preference", async (route) => {
        if (route.request().method() === "PUT") {
          if (failWrites) return route.fulfill({ status: 503, json: { error: { code: "COUNTRY_PREFERENCE_UNAVAILABLE", message: "Try again." } } });
          const choice = parseCountryPreferenceRequest(route.request().postDataJSON());
          if (!choice) return route.fulfill({ status: 400, json: {} });
          saved = {
            version: COUNTRY_PREFERENCE_VERSION,
            regionId: choice.regionId === undefined || (choice.adopt && saved.regionId !== null) ? saved.regionId : choice.regionId,
            displayCurrency: choice.displayCurrency === undefined || (choice.adopt && saved.displayCurrency !== null) ? saved.displayCurrency : choice.displayCurrency,
          };
        } else if (heldRead) await heldRead;
        return json(route, saved);
      });
    },
  };
}

function portfolio(region: RegionId, currency: FiatCurrencyCode) {
  const brl = currency === "BRL";
  const local = requiredLocalCashAsset("BRL");
  return buildBalancesSnapshotFixture({ region, currency, registry: {
    usdc: { balance: ready("10000000"), cashValue: pricedCash("USD", "1000"), value: priced(currency, brl ? "5000" : "1000") },
    [local.id]: { balance: ready((BigInt(20) * BigInt(10) ** BigInt(local.decimals)).toString()), cashValue: pricedCash("BRL", "2000"), value: priced(currency, brl ? "2000" : "400") },
    cbbtc: { balance: ready("100000"), value: priced(currency, brl ? "30000" : "6000") },
  } });
}

async function setup(page: Page, store = preferenceStore()) {
  await seedSignedInSession(page, "BR");
  await installApiFixtures(page, { countryPreferenceRegion: "BR" });
  await store.install(page);
  await page.route("**/api/balances**", (route) => {
    const url = new URL(route.request().url());
    const region = url.searchParams.get("region") ?? "BR";
    if (!isRegionId(region)) throw new Error("Invalid fixture country");
    const currency = url.searchParams.get("currency") ?? presentationRegions[region].currency.code ?? "USD";
    if (!isOfferedDisplayCurrency(currency)) throw new Error("Invalid fixture currency");
    return json(route, portfolio(region, currency));
  });
  const market = marketPricesFixture();
  if (market.markets.crypto.status === "ready") {
    market.markets.crypto.snapshots = market.markets.crypto.snapshots.map((snapshot) => ({
      ...snapshot, displayPrice: snapshot.displayPrice.replaceAll(",", ""),
    }));
  }
  await page.route("**/api/market-prices", (route) => json(route, { ...market, fx: [{ quoteCurrency: "BRL", status: "fresh", quoteUnitsPerUsd: { atoms: "5", scale: 0 } }] }));
  return store;
}

async function chooseCurrency(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Display currency", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function chooseCountry(page: Page, name: string) {
  const input = page.getByRole("combobox", { name: "Country", exact: true });
  await input.click();
  await input.press("ControlOrMeta+A");
  await input.pressSequentially(name);
  await expect(input).toHaveValue(name);
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await page.getByRole("option", { name, exact: true }).click();
}

async function settings(page: Page) {
  await page.goto("/home?account=settings");
  await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toBeEnabled();
}

async function expectUsdPortfolio(page: Page) {
  await expect(page.getByLabel("Total balance", { exact: true })).toContainText(/\$\s*74,00/);
  const money = page.getByRole("region", { name: "Your money", exact: true });
  await expect(money.getByRole("button", { name: /^Cash / })).toContainText(/\$\s*14,00/);
  await expect(money.getByRole("button", { name: /^Investments / })).toContainText(/\$\s*60,00/);
}

async function expectBrazilDiscovery(page: Page) {
  await page.getByRole("link", { name: "Add money", exact: true }).click();
  await expect(page.getByRole("dialog").locator('[data-slot="alert-description"]').getByText("No local deposit method in Brazil yet.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close add money" }).click();
  await page.getByRole("button", { name: "Cash out", exact: true }).click();
  await expect(page.getByText("Cash out to Brazilian real isn't available yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close cash-out dialog" }).click();
}

test("display currency persists across Home, Activity, Invest, reload and another device without changing country or native money", async ({ page, browser, context, baseURL }) => {
  test.setTimeout(60_000);
  const store = await setup(page);
  await page.goto("/home");
  await expect(page.getByLabel("Total balance", { exact: true })).toContainText(/R\$\s*370,00/);
  await expectBrazilDiscovery(page);
  await settings(page);
  await expect(page.getByText("Country default", { exact: true })).toBeVisible();
  await chooseCurrency(page, "Brazilian real");
  await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
  await expect(page.locator("#display-currency-status")).toHaveText("Display currency saved to your account.");
  await page.reload();
  await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toContainText("Brazilian real");
  await chooseCurrency(page, "US dollar");
  await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
  await expect(page.locator("#display-currency-status")).toHaveText("Display currency saved to your account.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectNavigation(page, "/home");
  await expectUsdPortfolio(page);
  await expectBrazilDiscovery(page);
  await page.goto("/activity");
  const received = page.getByRole("button", { name: /^Received / }).first();
  await expect(received).toContainText(/\$\s*25,00/);
  await received.click();
  await expect(page.getByRole("dialog", { name: "Received", exact: true })).toContainText("USDC");
  await page.getByRole("button", { name: "Close Received details", exact: true }).click();
  await page.goto("/invest");
  await expect(page.getByRole("button", { name: /Bitcoin/ }).first()).toContainText(/\$\s*60\.000,00/);
  await page.goto("/cash");
  await expect(page.getByText(/R\$\s*20,00/).first()).toBeVisible();
  await expect(page.getByText(/\$\s*10,00/).first()).toBeVisible();
  await page.goto("/investments");
  await expect(page.getByRole("button", { name: /Bitcoin/ }).first()).toContainText(/0,001\s*cbBTC/);
  await page.goto("/home");
  await page.reload();
  await expectUsdPortfolio(page);
  const fresh = await browser.newContext({ baseURL, storageState: { cookies: (await context.cookies()).filter((cookie) => cookie.name === "home-access"), origins: [] } });
  try {
    const other = await fresh.newPage();
    await setup(other, store);
    await other.goto("/home");
    await expectUsdPortfolio(other);
    await settings(other);
    await chooseCountry(other, "United States");
    await expect(other.getByText("Chosen by you", { exact: true })).toBeVisible();
    await expect(other.getByRole("combobox", { name: "Display currency", exact: true })).toContainText("US dollar");
    await chooseCurrency(other, "Country default (US dollar)");
    await expect(other.getByText("Country default", { exact: true })).toBeVisible();
    await chooseCountry(other, "Brazil");
    await expect(other.getByRole("combobox", { name: "Display currency", exact: true })).toContainText("Brazilian real");
    await expect(other.getByText("Country default", { exact: true })).toBeVisible();
  } finally { await fresh.close(); }
});

test("unavailable FX is visible across balance heroes and recovers without showing zero", async ({ page }) => {
  await setup(page);
  let missingFx = true;
  await page.route("**/api/balances**", (route) => {
    const snapshot = portfolio("BR", "BRL");
    if (missingFx) {
      for (const holding of snapshot.holdings) {
        if (holding.id === "usdc" || holding.id === "cbbtc") holding.value = { status: "unpriced", reason: "fx-unavailable" };
      }
    }
    return json(route, snapshot);
  });
  await page.goto("/home");
  const total = page.getByLabel("Total balance", { exact: true });
  await expect(total.getByText("Value unavailable", { exact: true }).first()).toBeVisible();
  await expect(total.locator("[data-signed-balance-bar]")).toHaveCount(0);
  const money = page.getByRole("region", { name: "Your money", exact: true });
  await expect(money.getByRole("button", { name: /^Cash\b.*Value unavailable/ })).toBeVisible();
  await expect(money.getByRole("button", { name: /^Investments\b.*Value unavailable/ })).toBeVisible();
  const allocation = page.getByRole("list", { name: "Balance allocation" });
  await expect(allocation.getByRole("button", { name: "Cash Value unavailable", exact: true })).toBeVisible();
  await expect(allocation.getByRole("button", { name: "Investments Value unavailable", exact: true })).toBeVisible();
  await page.goto("/cash");
  const cash = page.getByLabel("Cash balance", { exact: true });
  await expect(cash.getByText("Value unavailable", { exact: true })).toBeVisible();
  await page.goto("/investments");
  const investments = page.getByLabel("Investments balance", { exact: true });
  await expect(investments.getByText("Value unavailable", { exact: true })).toBeVisible();
  missingFx = false;
  await page.reload();
  await expect(investments).toContainText(/R\$\s*300,00/);
  await expect(investments.getByText("Value unavailable", { exact: true })).toHaveCount(0);
  await page.goto("/home");
  await expect(total).toContainText(/R\$\s*370,00/);
});

test("failed currency save is visit-only until Try again succeeds and survives reload", async ({ page }) => {
  const store = await setup(page);
  await settings(page);
  store.failWrites(true);
  await chooseCurrency(page, "US dollar");
  await expect(page.locator("#display-currency-status")).toContainText("this visit only");
  await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
  store.failWrites(false);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("#display-currency-status")).toHaveText("Display currency saved to your account.");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toBeEnabled();
  await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toContainText("US dollar");
});

test("slow account preference read never claims a browser choice was saved", async ({ page }) => {
  const store = await setup(page, preferenceStore("USD"));
  store.holdRead();
  await page.addInitScript(() => localStorage.setItem("home.displayCurrency.v1", "BRL"));
  try {
    await page.goto("/home?account=settings");
    await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toBeDisabled();
    await expect(page.locator("#display-currency-status")).toHaveText("Checking saved country preference.");
    await expect(page.getByText("Chosen by you", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Display currency saved/)).toHaveCount(0);
    store.releaseRead();
    await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Display currency", exact: true })).toContainText("US dollar");
  } finally { store.releaseRead(); }
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`display currency picker stays within ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await settings(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole("combobox", { name: "Display currency", exact: true }).click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    const bounds = await list.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("Currency picker is not visible");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await test.info().attach("picker-geometry", { contentType: "application/json", body: JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyStyle: document.body.getAttribute("style"), overflow: Array.from(document.querySelectorAll("body *")).flatMap((element) => { const box = element.getBoundingClientRect(); return box.right > innerWidth + 1 && box.width > 0 ? [{ tag: element.tagName, slot: element.getAttribute("data-slot"), right: box.right, text: element.textContent?.slice(0, 70) }] : []; }).slice(0, 15) }))) });
    await page.getByRole("option", { name: "US dollar", exact: true }).click();
    await expect(page.getByText("Chosen by you", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
