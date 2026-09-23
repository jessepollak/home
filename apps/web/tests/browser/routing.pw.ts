import { expect, test } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";
import { trackHydrationErrors } from "./fixtures/hydration-errors";

test("canonical routing preserves the shell and one balances read", async ({ page }) => {
  await seedSignedInSession(page);
  const fixtures = await installApiFixtures(page);
  await page.goto("/home");
  await expect.poll(() => fixtures.balancesReadsForRegion("US")).toBe(1);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("dialog", { name: "Send" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Send" })).toHaveCount(0);

  await page.getByRole("button", { name: "Your money", exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
  await page.getByRole("button", { name: "Invest", exact: true }).click();
  await expect(page).toHaveURL(/\/invest$/);
  await page.evaluate(() => {
    for (const node of [
      document.querySelector<HTMLElement>("[data-app-main-authenticated]"),
      document.querySelector<HTMLElement>("header"),
    ]) {
      if (node) (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe = true;
    }
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/balances$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/balances$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/invest$/);
  expect(await page.evaluate(() => [
    document.querySelector<HTMLElement>("[data-app-main-authenticated]"),
    document.querySelector<HTMLElement>("header"),
  ].every((node) => node && (node as HTMLElement & { __shellProbe?: boolean }).__shellProbe)))
    .toBe(true);
  expect(fixtures.balancesReads()).toBe(1);
});

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
    await expect(page).toHaveURL(/\/home\?account=settings$/);
    await expect(settings).toBeVisible();
    await expect(settings).toBeFocused();
    await expect(page.getByRole("banner").getByRole("button", { name: "Account" }))
      .toHaveCount(0);
    expect(await readPrimaryNavigationTargets()).toContain(await settings.getAttribute("id"));
  };

  await openSettingsWithKeyboard();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(settings).toHaveCount(0);
  await expectExactOpenerFocused();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await readPrimaryNavigationTargets();

  await openSettingsWithKeyboard();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await expect(settings).toHaveCount(0);
  await expectExactOpenerFocused();
  await readPrimaryNavigationTargets();

  await page.goForward();
  await expect(page).toHaveURL(/\/home\?account=settings$/);
  await expect(settings).toBeFocused();
  expect(await readPrimaryNavigationTargets()).toContain(await settings.getAttribute("id"));
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/\/home$/);
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
  await expect(page).toHaveURL(/\/home$/);
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await readPrimaryNavigationTargets();
});

test("sign-in returns to Save through the signed-in shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiFixtures(page);
  await page.goto("/save");
  await expect(page).toHaveURL(/\/?\?account=signin$/);
  await expect(page.getByRole("dialog", { name: "Sign in to Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Save" })).toHaveCount(0);

  await page.getByLabel("Email address").fill("fixture@example.test");
  await page.getByLabel("Email address").press("Enter");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: "Open Save" }).click();
  await expect(page).toHaveURL(/\/save$/);
  await expect(page.getByRole("region", { name: "Save" })).toBeVisible();
});

test("representative canonical routes SSR and hydrate their selected panel", async ({ page }) => {
  await seedSignedInSession(page, "GB");
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("home.query.v1:")) localStorage.removeItem(key);
    }
  });
  await installApiFixtures(page);
  const hydrationErrors = trackHydrationErrors(page);
  const routes = [
    ["/home", ">Total balance<", "Home"],
    ["/balances/investments", 'aria-label="Your money"', "Your money"],
    ["/invest/nvdac", 'aria-label="NVIDIA"', "NVIDIA"],
  ] as const;
  for (const [url, ssrMarker, title] of routes) {
    const html = await page.request.get(url).then((response) => response.text());
    expect(html).toContain(ssrMarker);
    expect((html.match(/<div data-shell-panel=""[^>]*>/g) ?? [])
      .filter((tag) => !tag.includes("hidden"))).toHaveLength(1);
    await page.goto(url);
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText(title);
  }
  expect(hydrationErrors).toEqual([]);
});
