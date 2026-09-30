import { expect, test, type Locator, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { cashoutFixtureWithdraw } from "./feature-map/cashout-fixture";

const PEER_OFFRAMP = {
  version: 2,
  direction: "offramp",
  providers: [{
    direction: "offramp", providerId: "peer", displayName: "Peer", region: "US", assetId: "base:usdc",
    assetSymbol: "USDC", assetDecimals: 6, currency: "USD", quotes: false, kyc: null,
    paymentMethods: [{ id: "cashapp", label: "Cash App", platform: "cashapp", handleHint: "Cashtag", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "pending" }],
  }],
};

const IDRX_TWO_METHODS = {
  version: 3,
  direction: "onramp",
  providers: [{
    direction: "onramp", providerId: "idrx", displayName: "IDRX", region: "ID", assetId: "base:idrx",
    assetSymbol: "IDRX", assetDecimals: 2, currency: "IDR", quotes: false, customerSetup: null,
    paymentMethods: [
      { id: "bank-va-mandiri", label: "Bank transfer · Mandiri" },
      { id: "bank-va-bca", label: "Bank transfer · BCA" },
    ],
  }],
};

const ID_LONG_METHODS = {
  version: 3,
  direction: "onramp",
  providers: [
    IDRX_TWO_METHODS.providers[0],
    {
      ...IDRX_TWO_METHODS.providers[0],
      providerId: "island-pay",
      assetId: "base:idrx-island-pay",
      displayName: "Island Payment Network",
      paymentMethods: [
        { id: "bank", label: "Bank transfer with any Indonesian financial institution" },
        { id: "wallet", label: "Mobile wallet payment at participating merchants" },
        { id: "card", label: "Debit card" },
        { id: "cash", label: "Cash deposit" },
      ],
    },
  ],
};

async function inputMetrics(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: Number.parseFloat(style.height), fontSize: Number.parseFloat(style.fontSize) };
  });
}

async function optionHeight(locator: Locator) {
  return locator.evaluate((element) => (element as HTMLElement).offsetHeight);
}

async function expectTouchHeight(option: Locator, label: string) {
  await expect(option).toBeVisible();
  expect(Math.round(await optionHeight(option)), `${label} option height`).toBeGreaterThanOrEqual(44);
}

async function waitForHomeMark(page: Page, mark: "session:verified" | "action:first-interactive") {
  await expect.poll(() => page.evaluate((name) =>
    performance.getEntriesByName(name, "mark").length, mark), {
    timeout: process.env.CI ? 10_000 : 5_000,
  }).toBeGreaterThan(0);
}

async function openPaymentMethodRadioGroup(page: Page) {
  await page.goto("/home");
  await waitForHomeMark(page, "action:first-interactive");
  await page.getByRole("button", { name: "Add money" }).click();
  await page.getByRole("button", { name: /Deposit IDR/ }).click();
  return page.getByRole("radiogroup", { name: "Payment method" });
}

async function openCountryCombobox(page: Page) {
  await page.goto("/home?account=settings");
  await waitForHomeMark(page, "session:verified");
  await page.getByRole("combobox", { name: "Country" }).click();
}

async function installPickerFixtures(page: Page) {
  await seedSignedInSession(page, "ID");
  await installApiFixtures(page);
  await page.route("**/api/funding/providers**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("region") !== "ID") return route.fallback();
    return json(route, IDRX_TWO_METHODS);
  });
}

test("add-money method rows contain their full descriptions and loading geometry matches", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page, "ID");
  await installApiFixtures(page);
  let releaseProviders = () => {};
  const providersReleased = new Promise<void>((resolve) => { releaseProviders = resolve; });
  await page.route("**/api/funding/providers**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("region") !== "ID") return route.fallback();
    await providersReleased;
    return json(route, ID_LONG_METHODS);
  });
  await page.goto("/home?flow=add-money");
  const dialog = page.getByRole("dialog", { name: "Add money" });
  const receive = dialog.getByRole("button", { name: /Receive crypto/ });
  const deposits = dialog.getByRole("button", { name: /Deposit IDR/ });
  const shimmer = dialog.locator('[aria-hidden="true"]:has([data-shimmer="deposit-method"])');
  await expect(receive).toBeVisible();
  await expect(shimmer).toBeVisible();
  const loaded = await receive.evaluate((element) => {
    const rowBox = element.getBoundingClientRect();
    const content = element.querySelector('[data-slot="item-content"]')!.getBoundingClientRect();
    const lines = [...element.querySelectorAll('[data-slot="item-content"] > :not([hidden])')];
    const description = lines[1]!;
    const lineHeight = parseFloat(getComputedStyle(description).lineHeight);
    const extraLines = description.getBoundingClientRect().height - lineHeight;
    return {
      height: rowBox.height - extraLines,
      top: content.top - rowBox.top,
      bottom: rowBox.bottom - content.bottom,
      title: lines[0]!.getBoundingClientRect().height,
      description: lineHeight,
    };
  });
  const loading = await shimmer.evaluate((element) => {
    const rowBox = element.getBoundingClientRect();
    const content = element.querySelector('[data-slot="item-content"]')!.getBoundingClientRect();
    const [title, description] = element.querySelectorAll('[data-slot="item-content"] > [data-shimmer]');
    return {
      height: rowBox.height,
      top: content.top - rowBox.top,
      bottom: rowBox.bottom - content.bottom,
      title: title!.getBoundingClientRect().height,
      description: description!.getBoundingClientRect().height,
    };
  });
  for (const key of Object.keys(loaded) as (keyof typeof loaded)[]) {
    expect(Math.abs(loading[key] - loaded[key]), key).toBeLessThanOrEqual(1);
  }

  releaseProviders();
  await expect(deposits).toHaveCount(2);
  await expect(shimmer).toHaveCount(0);
  await expect(deposits.nth(1).locator('[data-slot="item-description"]'))
    .toContainText("Mobile wallet payment at participating merchants");

  for (const rootFontSize of ["100%", "200%"]) {
    await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, rootFontSize);
    for (const row of [receive, deposits.nth(0), deposits.nth(1)]) {
      const metrics = await row.evaluate((element) => {
        const rowBox = element.getBoundingClientRect();
        const contentBox = element.querySelector('[data-slot="item-content"]')!.getBoundingClientRect();
        const text = element.querySelector('[data-slot="item-description"]')!;
        return {
          height: rowBox.height,
          top: contentBox.top - rowBox.top,
          bottom: rowBox.bottom - contentBox.bottom,
          description: {
            scrollHeight: text.scrollHeight, clientHeight: text.clientHeight,
            scrollWidth: text.scrollWidth, clientWidth: text.clientWidth,
          },
        };
      });
      expect(metrics.height).toBeGreaterThanOrEqual(44);
      expect(metrics.top).toBeGreaterThanOrEqual(8);
      expect(metrics.bottom).toBeGreaterThanOrEqual(8);
      const { description } = metrics;
      expect(description.scrollHeight).toBeLessThanOrEqual(description.clientHeight + 1);
      expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth + 1);
    }
  }
});

test("coverage native selects keep a mobile-zoom-safe font size", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/coverage");
    const selects = page.getByRole("combobox");
    await expect(selects.first()).toBeVisible();
    await expect.poll(async () => {
      const fontSizes = await selects.evaluateAll((nodes) =>
        nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize)));
      return fontSizes.length >= 4 && fontSizes.every(Number.isFinite) ? Math.min(...fontSizes) : 0;
    }).toBeGreaterThanOrEqual(16);
  }
});

async function openPeerCashOutHandle(page: Page) {
  await page.goto("/home");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("textbox", { name: "Amount" }).pressSequentially("1");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Send to Cash App/ }).click();
  await page.getByRole("button", { name: "Cash App" }).click();
}

test("mobile cash-out destination review remains within the dialog", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.route("**/api/funding/providers**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("direction") !== "offramp") return route.fallback();
    return json(route, PEER_OFFRAMP);
  });
  const canonical = "averyveryveryveryveryveryverylongcashappcashtag@example.com";
  await page.route("**/api/actions/prepare", (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.kind !== "cash-out") return route.fallback();
    return json(route, {
      ...cashoutFixtureWithdraw, kind: "cash-out", title: "Cash out with Peer",
      amounts: [{ assetId: "usdc", symbol: "USDC", decimals: 6, amountBaseUnits: "1000000", direction: "spend" }],
      metadata: { ...cashoutFixtureWithdraw.metadata, operation: "deposit", canonicalHandle: canonical,
        approximateFiatAmount: "1", etaSeconds: 60, quote: {
          fees: { provider: { amount: "0", currency: "USD" }, network: null, operator: null }, rate: null,
          receive: { amount: "1", currency: "USD", approximate: true },
          arrival: { source: "observed", kind: "within", seconds: 60 },
        } },
    });
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await openPeerCashOutHandle(page);
    const dialog = page.getByRole("dialog");
    const sameDialog = await dialog.elementHandle();
    const handle = dialog.getByRole("textbox", { name: "Cash App cashtag" });
    await expect(handle).toBeVisible();
    await expect.poll(async () => (await inputMetrics(handle)).fontSize).toBeGreaterThanOrEqual(16);
    if (viewport.width < 400) await expect.poll(async () => (await inputMetrics(handle)).height).toBeGreaterThanOrEqual(44);

    await handle.fill(`$${canonical}`);
    await dialog.getByRole("button", { name: "Review" }).click();
    const callout = dialog.getByRole("group", { name: "Payout destination" });
    await expect(callout).toContainText(canonical);
    await expect(callout).toContainText("Cash App · Cashtag");
    expect(await dialog.evaluate((element, original) => element === original, sameDialog)).toBe(true);
    expect(await callout.evaluate((element) => {
      const dialog = element.closest('[role="dialog"]')!;
      const box = element.getBoundingClientRect();
      const bounds = dialog.getBoundingClientRect();
      return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 &&
        element.scrollWidth <= element.clientWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1 &&
        document.documentElement.scrollWidth <= innerWidth + 1;
    })).toBe(true);
    expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.type === "text")).toBe(false);
    const edit = callout.getByRole("button", { name: "Edit Cash App cashtag" });
    if (viewport.width < 400) expect(await optionHeight(edit)).toBeGreaterThanOrEqual(44);
    await edit.click();
    await expect(dialog.getByRole("textbox", { name: "Cash App cashtag" })).toHaveValue(`$${canonical}`);
    await expect(dialog.getByRole("textbox", { name: "Cash App cashtag" })).toBeFocused();
    expect(await dialog.evaluate((element, original) => element === original, sameDialog)).toBe(true);
  }
});

test.describe("touch pickers", () => {
  test.use({ hasTouch: true });
  test("shared picker options meet the mobile touch height", async ({ page }) => {
    await installPickerFixtures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const group = await openPaymentMethodRadioGroup(page);
    const mandiri = group.getByRole("radio", { name: "Bank transfer · Mandiri" });
    const bca = group.getByRole("radio", { name: "Bank transfer · BCA" });
    const mandiriRow = page.locator("label", { has: page.getByRole("radio", { name: "Bank transfer · Mandiri" }) });
    const bcaRow = page.locator("label", { has: page.getByRole("radio", { name: "Bank transfer · BCA" }) });
    await expectTouchHeight(mandiriRow, "RadioGroup label");
    await expectTouchHeight(bcaRow, "RadioGroup label");
    await expect(mandiri).toBeChecked();
    await bcaRow.tap();
    await expect(bca).toBeChecked();
    await expect(page.getByRole("dialog", { name: "Deposit IDR" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review quote" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review quote" })).toHaveCount(0);

    await openCountryCombobox(page);
    const country = page.getByRole("option", { name: "Indonesia" });
    await country.scrollIntoViewIfNeeded();
    await expectTouchHeight(country, "Combobox");
    await page.keyboard.press("Escape");
  });
});

test("mobile capsule floats above the browser-tab bottom while keeping content clear", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 0, right: 0, bottom: 34 },
  });
  await page.goto("/home");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  const emulatedInset = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.paddingBottom = "env(safe-area-inset-bottom)";
    document.body.append(probe);
    const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom);
    probe.remove();
    return inset;
  });
  expect(emulatedInset).toBe(34);

  await expect.poll(async () => navigation.evaluate((nav) =>
    Math.round(window.innerHeight - nav.getBoundingClientRect().bottom))).toBe(12);
  const main = page.locator("[data-app-main-authenticated]");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => main.evaluate((element) => {
    const lastContent = element.lastElementChild;
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
    return lastContent && nav ? lastContent.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top : false;
  })).toBe(true);
  const tabHeights = await navigation.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height));
  expect(tabHeights.length).toBeGreaterThan(0);
  for (const height of tabHeights) expect(height).toBeGreaterThanOrEqual(44);
});

test("header targets stay large while content controls keep fine-pointer density", async ({ browser, page }) => {
  async function openRepresentativeControls(targetPage: Page) {
    await installApiFixtures(targetPage);
    await targetPage.goto("/");
    const signIn = targetPage.getByRole("banner").getByRole("button", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    const signInHeight = await signIn.evaluate((element) => element.getBoundingClientRect().height);

    await seedSignedInSession(targetPage);
    await targetPage.goto("/home");
    await targetPage.getByRole("button", { name: "Send" }).click();
    const quickAmount = targetPage.getByRole("button", { name: "$10" });
    await expect(quickAmount).toBeVisible();
    return {
      signInHeight,
      quickAmountHeight: await quickAmount.evaluate((element) => element.getBoundingClientRect().height),
    };
  }

  const touchContext = await browser.newContext({
    hasTouch: true,
    viewport: { width: 844, height: 390 },
  });
  try {
    const touchPage = await touchContext.newPage();
    expect(await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(Math.min(...Object.values(await openRepresentativeControls(touchPage))))
      .toBeGreaterThanOrEqual(44);

    await touchPage.setViewportSize({ width: 320, height: 568 });
    await touchPage.getByRole("button", { name: "Close send dialog" }).click();
    await touchPage.getByRole("button", { name: "Account" }).click();
    const smallBalances = touchPage.getByRole("switch", { name: "Show small balances" });
    await expect(smallBalances).toBeVisible();
    await smallBalances.scrollIntoViewIfNeeded();
    await smallBalances.evaluate((element) =>
      element.scrollIntoView({ block: "center", inline: "nearest" }));
    await expect.poll(() => smallBalances.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 9 && bounds.bottom <= innerHeight - 9;
    })).toBe(true);

    const switchTarget = await smallBalances.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      const top = bounds.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(before.top);
      const bottom = bounds.bottom - Number.parseFloat(style.borderBottomWidth) - Number.parseFloat(before.bottom);
      return {
        paintedHeight: bounds.height,
        targetHeight: bottom - top,
        probe: { x: bounds.x + bounds.width / 2, y: (top + bounds.top) / 2 },
      };
    });
    expect(switchTarget.paintedHeight).toBe(28);
    expect(switchTarget.targetHeight).toBeGreaterThanOrEqual(44);

    const checkedBefore = await smallBalances.getAttribute("aria-checked");
    await touchPage.touchscreen.tap(switchTarget.probe.x, switchTarget.probe.y);
    await expect(smallBalances).not.toHaveAttribute("aria-checked", checkedBefore ?? "");
  } finally {
    await touchContext.close();
  }

  await page.setViewportSize({ width: 900, height: 844 });
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
  expect(await openRepresentativeControls(page)).toEqual({ signInHeight: 44, quickAmountHeight: 28 });
});
