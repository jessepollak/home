import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";
import { expectNavigation } from "./fixtures/navigation-budget";
import { FUNDING_PROVIDERS_VERSION } from "../../shared/funding/contracts/providers";

test("canonical routing preserves the shell and one balances read", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expect.poll(() => fixtures.balancesReadsForRegion("US")).toBe(1);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Send" })).toHaveCount(0);

  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expectNavigation(page, /\/cash$/);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expectNavigation(page, /\/invest$/);
  await page.evaluate(() => {
    for (const node of [
      document.querySelector<HTMLElement>("[data-app-main-authenticated]"),
      document.querySelector<HTMLElement>("header"),
    ]) {
      if (node) (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe = true;
    }
  });
  await page.goBack();
  await expectNavigation(page, /\/cash$/);
  await page.goBack();
  await expectNavigation(page, /\/home$/);
  await page.goForward();
  await expectNavigation(page, /\/cash$/);
  await page.goForward();
  await expectNavigation(page, /\/invest$/);
  expect(await page.evaluate(() => [
    document.querySelector<HTMLElement>("[data-app-main-authenticated]"),
    document.querySelector<HTMLElement>("header"),
  ].every((node) => node && (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe)))
    .toBe(true);
  expect(fixtures.balancesReads()).toBe(1);
});

test("switching away from nested Invest and back opens the Invest overview", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: "Invest", exact: true }).click();
  await expectNavigation(page, /\/invest$/);
  await page.getByRole("region", { name: "Crypto" }).getByRole("button", { name: "See all ›" }).click();
  await expectNavigation(page, /\/invest\/crypto$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Crypto");

  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await expectNavigation(page, /\/home$/);
  await navigation.getByRole("button", { name: "Invest", exact: true }).click();
  await expectNavigation(page, /\/invest$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Invest");
  await expect(page.getByRole("button", { name: "Back to Invest" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Crypto" })).toBeVisible();

  await page.getByRole("region", { name: "Crypto" }).getByRole("button", { name: "See all ›" }).click();
  await navigation.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("region", { name: "Your money" })
    .getByRole("button", { name: /^Investments/ }).click();
  await expectNavigation(page, /\/investments$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Investments");
  await expect(page.getByRole("region", { name: "Your investments" })).toBeVisible();
});

test("tapping active Invest from a category pushes a root entry that Back restores", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

  const investTab = page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Invest", exact: true });
  await investTab.click();
  await expectNavigation(page, /\/invest$/);
  await page.getByRole("region", { name: "Crypto" }).getByRole("button", { name: "See all ›" }).click();
  await expectNavigation(page, /\/invest\/crypto$/);
  await investTab.click();
  await expectNavigation(page, /\/invest$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Invest");
  await expect(page.getByRole("button", { name: "Back to Invest" })).toHaveCount(0);
  await investTab.click();

  await page.goBack();
  await expectNavigation(page, /\/invest\/crypto$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Crypto");
  await expect(page.getByRole("button", { name: "Back to Invest" })).toBeVisible();
  await page.goBack();
  await expectNavigation(page, /\/invest$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Invest");
});

test("tapping active Invest from a crypto asset preserves category Back after browser Back", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

  const investTab = page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Invest", exact: true });
  await investTab.click();
  await page.getByRole("region", { name: "Crypto" }).getByRole("button", { name: "See all ›" }).click();
  await expectNavigation(page, /\/invest\/crypto$/);
  await page.getByRole("button", { name: /Bitcoin/ }).click();
  await expectNavigation(page, /\/invest\/cbbtc$/);

  await investTab.click();
  await expectNavigation(page, /\/invest$/);
  await page.goBack();
  await expectNavigation(page, /\/invest\/cbbtc$/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/invest\/crypto$/);
  await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Crypto");
  await expect(page.getByRole("button", { name: "Back to Invest" })).toBeVisible();
});

test("navigation and chrome keep focus across the rail breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

  for (const [rail, mobile] of [
    [page.locator("#invest-rail-nav"), page.locator("#invest-nav")],
    [page.locator("#home-rail-nav"), page.locator("#home-nav")],
    [page.locator('#desktop-rail [data-breakpoint-peer="home-mark"]'), page.locator('header [data-breakpoint-peer="home-mark"] button')],
    [page.locator("[data-rail-account-action]"), page.locator("[data-shell-account-action] button")],
  ]) {
    await expect(rail).toBeVisible();
    await rail.focus();
    await expect(rail).toBeFocused();
    await page.setViewportSize({ width: 1023, height: 768 });
    await expect(mobile).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(rail).toBeFocused();
  }

  const toggle = page.locator("#desktop-rail").getByRole("button", { name: "Sidebar" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 1023, height: 768 });
  const homeTab = page.locator("#home-nav");
  await expect(homeTab).toBeVisible();
  await expect(homeTab).toBeFocused();
});

test("breakpoint focus keeps Home on nested pages and stays in open Account settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/cash");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect(page.locator("[data-rail-account-action]")).toBeEnabled();
  const railMark = page.locator('#desktop-rail [data-breakpoint-peer="home-mark"]');
  await expect(railMark).toBeVisible();
  await railMark.focus();
  await expect(railMark).toBeFocused();
  await page.setViewportSize({ width: 1023, height: 768 });
  await expect(page.locator("#home-nav")).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 720 });
  const railAccount = page.locator("[data-rail-account-action]");
  await expect(railAccount).toBeEnabled();
  await railAccount.click();
  await expect(page.getByRole("region", { name: "Account settings" })).toBeVisible();
  await railAccount.focus();
  await expect(railAccount).toBeFocused();
  await page.setViewportSize({ width: 1023, height: 768 });
  await expect(page.getByRole("region", { name: "Account settings" })).toBeFocused();
});

test("desktop rail keeps routing, collapse state, and money dialog focus across breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();

  const rail = page.locator("#desktop-rail");
  const navigation = rail.getByRole("navigation", { name: "Main navigation" });
  const home = navigation.getByRole("button", { name: "Home", exact: true });
  const invest = navigation.getByRole("button", { name: "Invest", exact: true });
  await expect(rail).toBeVisible();
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#home-nav")).toBeHidden();

  await invest.click();
  await expectNavigation(page, /\/invest$/);
  await expect(invest).toHaveAttribute("aria-current", "page");
  await page.getByRole("region", { name: "Crypto" }).getByRole("button", { name: "See all ›" }).click();
  await expectNavigation(page, /\/invest\/crypto$/);
  await page.goBack();
  await expectNavigation(page, /\/invest$/);
  await expect(invest).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expectNavigation(page, /\/home$/);
  await expect(home).toHaveAttribute("aria-current", "page");

  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expectNavigation(page, /\/cash$/);
  await expect(home).toHaveAttribute("aria-current", "page");

  const toggle = rail.getByRole("button", { name: "Sidebar" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBe(64);
  await page.addInitScript(() => {
    const runs: string[] = [];
    Object.defineProperty(window, "__railTransitionRuns", { value: runs });
    document.addEventListener("transitionrun", (event) => {
      if (event.target instanceof Element && event.target.id === "desktop-rail") runs.push(event.propertyName);
    }, true);
  });
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBe(64);
  await expect(home).toHaveAttribute("aria-current", "page");

  expect(await page.evaluate(() => (window as Window & { __railTransitionRuns?: string[] }).__railTransitionRuns)).toEqual([]);
  await home.click();
  await expectNavigation(page, /\/home$/);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  const dialog = page.getByRole("dialog", { name: "Send" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width <= 480 && Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) <= 1;
  })).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(send).toBeFocused();

  await page.setViewportSize({ width: 1023, height: 768 });
  await expect(rail).toBeHidden();
  const tabBar = page.locator("#home-nav").locator("xpath=ancestor::nav");
  await expect(tabBar).toBeVisible();
  await expect(page.locator("#home-nav")).toHaveAttribute("aria-current", "page");
});

test("desktop destinations other than Home stay in the 640px column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  for (const path of ["/cash", "/invest", "/investments", "/investments/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"]) {
    await page.goto(path);
    const panel = page.locator("#navigation-panel > div");
    await expect(panel).toHaveCount(1);
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(640);
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`money dialogs return focus to their openers at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/funding/providers**", (route) => {
      if (new URL(route.request().url()).searchParams.get("direction") !== "offramp") return route.fallback();
      return json(route, {
        version: FUNDING_PROVIDERS_VERSION,
        direction: "offramp",
        providers: [{
          direction: "offramp", providerId: "peer", displayName: "Peer", region: "US", assetId: "base:usdc",
          assetSymbol: "USDC", assetDecimals: 6, currency: "USD", quotes: false, customerSetup: null,
          paymentMethods: [{ id: "cashapp", label: "Cash App", platform: "cashapp", handleHint: "Cashtag", minimumAmountAtomic: "10000", maximumAmountAtomic: null, estimateSemantics: "approximate", etaSemantics: "historical-not-guaranteed", corridorConfirmedBy: "pending" }],
        }],
      });
    });
    await page.goto("/home");

    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName("action:first-interactive", "mark").length), {
      timeout: process.env.CI ? 10_000 : 5_000,
    }).toBeGreaterThan(0);
    const addMoney = page.getByRole("link", { name: "Add money", exact: true }).first();
    await expect(addMoney).toBeVisible();
    await addMoney.click();
    const addDialog = page.getByRole("dialog", { name: "Add money" });
    await expect(addDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addDialog).toHaveCount(0);
    await expect(addMoney).toBeFocused();

    await addMoney.click();
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole("button", { name: "Close add money" }).click();
    await expect(addDialog).toHaveCount(0);
    await expect(addMoney).toBeFocused();

    const send = page.getByRole("button", { name: "Send", exact: true });
    await send.click();
    const sendDialog = page.getByRole("dialog", { name: "Send" });
    await expect(sendDialog).toBeVisible();
    if (viewport.width >= 1024) {
      const keyboardInset = 300;
      const viewportTop = 100;
      await page.locator("[data-slot=drawer-viewport]").evaluate((element, frame) => {
        element.style.setProperty("--sheet-keyboard-inset", `${frame.inset}px`);
        element.style.setProperty("--sheet-keyboard-top", `${frame.top}px`);
      }, { inset: keyboardInset, top: viewportTop });
      await expect.poll(async () => (await sendDialog.boundingBox())?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(viewportTop);
      const continueButton = sendDialog.getByRole("button", { name: "Continue" });
      await expect.poll(async () => {
        const box = await continueButton.boundingBox();
        return box ? box.y + box.height : Number.POSITIVE_INFINITY;
      }).toBeLessThanOrEqual(viewport.height - keyboardInset);
      await page.locator("[data-slot=drawer-viewport]").evaluate((element) => {
        element.style.removeProperty("--sheet-keyboard-inset");
        element.style.removeProperty("--sheet-keyboard-top");
      });
    }
    await sendDialog.getByRole("button", { name: "Close send dialog" }).click();
    await expect(sendDialog).toHaveCount(0);
    await expect(send).toBeFocused();

    await send.click();
    await expect(sendDialog).toBeVisible();
    await sendDialog.getByRole("textbox", { name: "Amount" }).fill("1");
    await sendDialog.getByRole("button", { name: "Continue" }).click();
    await sendDialog.getByRole("button", { name: /Send to Cash App/ }).click();
    const cashOutDialog = page.getByRole("dialog", { name: "Cash out with Peer" });
    await expect(cashOutDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cashOutDialog).toHaveCount(0);
    await expect(send).toBeFocused();

    await page.goto("/cash/savings");
    const savingsRow = page.getByRole("region", { name: "Your savings" }).getByRole("button", { name: /^Gauntlet USDC Prime/ });
    await expect(savingsRow).toHaveAccessibleDescription("Manage Gauntlet USDC Prime");
    await savingsRow.click();
    const tray = page.getByRole("dialog", { name: "Gauntlet USDC Prime" });
    await expect(tray).toBeVisible();
    await tray.getByRole("button", { name: "Deposit more" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Deposit" });
    await expect(saveDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(saveDialog).toHaveCount(0);
    await expect(savingsRow).toBeFocused();
  });
}

test("Account settings moves focus into the view and restores it to the account trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);

  const readPrimaryNavigationTargets = async () => {
    const targets = await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-controls")));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      if (target === null) throw new Error("Primary navigation button is missing aria-controls");
      await expect(page.locator(`[id="${target}"]`)).toHaveCount(1);
    }
    return targets;
  };

  await page.goto("/home");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await readPrimaryNavigationTargets();

  const trigger = page.getByRole("banner").getByRole("button", { name: "Account" });
  await expect(trigger).toBeEnabled();
  await trigger.evaluate((element) => element.setAttribute("data-focus-opener", ""));
  const settings = page.getByRole("region", { name: "Account settings" });
  const expectExactOpenerFocused = async () => {
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-focus-opener") ?? false,
    )).toBe(true);
  };
  const openSettingsWithKeyboard = async () => {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expectNavigation(page, /\/home\?account=settings$/);
    await expect(settings).toBeVisible();
    await expect(settings).toBeFocused();
    await expect(page.getByRole("banner").getByRole("button", { name: "Account" }))
      .toHaveCount(0);
    expect(await readPrimaryNavigationTargets()).toContain(await settings.getAttribute("id"));
  };

  await openSettingsWithKeyboard();
  await page.getByRole("button", { name: "Done" }).click();
  await expectNavigation(page, /\/home$/);
  await expect(settings).toHaveCount(0);
  await expectExactOpenerFocused();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await readPrimaryNavigationTargets();

  await openSettingsWithKeyboard();
  await page.goBack();
  await expectNavigation(page, /\/home$/);
  await expect(settings).toHaveCount(0);
  await expectExactOpenerFocused();
  await readPrimaryNavigationTargets();

  await page.goForward();
  await expectNavigation(page, /\/home\?account=settings$/);
  await expect(settings).toBeFocused();
  expect(await readPrimaryNavigationTargets()).toContain(await settings.getAttribute("id"));
  await page.getByRole("button", { name: "Done" }).click();
  await expectNavigation(page, /\/home$/);
  await expect(settings).toHaveCount(0);
  await expectExactOpenerFocused();
  await readPrimaryNavigationTargets();

  await page.goto("/home?account=settings");
  await expect(settings).toBeVisible();
  await expect(settings).toBeFocused();
  await expect(page.getByRole("banner").getByRole("button", { name: "Account" }))
    .toHaveCount(0);
  expect(await readPrimaryNavigationTargets()).toContain(await settings.getAttribute("id"));
  await page.getByRole("button", { name: "Done" }).click();
  await expectNavigation(page, /\/home$/);
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await readPrimaryNavigationTargets();
});

test("sign-in returns to Cash through the signed-in shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiFixtures(page);
  await page.goto("/cash");
  await expectNavigation(page, /\/?\?account=signin$/);
  await expect(page.getByRole("dialog", { name: "Sign in to Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cash" })).toHaveCount(0);

  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectNavigation(page, /\/home$/);
  await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Cash/ }).click();
  await expectNavigation(page, /\/cash$/);
  await expect(page.getByRole("region", { name: "Cash" })).toBeVisible();
});

test("sign-in code slots accept paste, editing and scripted autofill", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installApiFixtures(page);
  await page.goto("/?account=signin");
  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  const code = page.getByRole("textbox", { name: "Verification code" });
  const verify = page.getByRole("button", { name: "Verify and continue" });
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toHaveAttribute("inputmode", "numeric");

  await page.keyboard.type("01a2");
  await expect(code).toHaveValue("012");
  await page.keyboard.press("Backspace");
  await expect(code).toHaveValue("01");
  await expect(verify).toBeDisabled();

  await code.evaluate((input: HTMLInputElement) => {
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData("text/plain", "012 345");
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(code).toHaveValue("012345");
  await expect(verify).toBeEnabled();

  await code.evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "654321");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(code).toHaveValue("654321");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await verify.click();
  await expectNavigation(page, /\/home$/);
});

test("representative canonical routes SSR and hydrate their selected panel", async ({ page }) => {
  await seedSignedInSession(page, "GB");
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("home-query-cache");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("home.query.v1:")) localStorage.removeItem(key);
    }
  });
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  const routes = [
    ["/home", ">Total balance<", "Home"],
    ["/cash", 'id="cash-panel"', "Cash"],
    ["/invest/nvdac", 'aria-label="NVIDIA"', "NVIDIA"],
  ] as const;
  for (const [url, ssrMarker, title] of routes) {
    const html = await page.request.get(url).then((response) => response.text());
    expect(html).toContain(ssrMarker);
    expect(html).toContain("data-app-main-authenticated");
    await page.goto(url);
    await expect(page.locator("main[data-app-main-authenticated]")).toHaveCount(1);
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText(title);
  }
  expect(hydrationErrors).toEqual([]);
});

test("the Card route redirects Home while the card journey is disabled", async ({ page }) => {
  test.skip(process.env.BRIDGE_CARDS_ENABLED === "1", "Card journey is enabled in this environment");
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/card", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/home");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Card", exact: true })).toHaveCount(0);
  await page.goto("/card/extra", { waitUntil: "domcontentloaded" });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/home");
  await expect(page.locator("main[data-app-main-authenticated]")).toHaveCount(1);
});

test("non-canonical shell paths render their canonical parent instead of 404", async ({ page }) => {
  await seedSignedInSession(page);
  await installApiFixtures(page);
  for (const [url, title] of [
    ["/home/nope", "Home"],
    ["/activity/nope", "Activity"],
    ["/cash/nope", "Cash"],
    ["/cash/savings/extra", "Cash"],
    ["/unknown", "Home"],
  ] as const) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expectNavigation(page, url);
    await expect(page.locator("main[data-app-main-authenticated]")).toHaveCount(1);
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText(title);
  }
});
