import { expect, test, type Locator } from "@playwright/test";
import { isRecord } from "@/shared/guards";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { assetResolutionFixture, searchFixture } from "./feature-map/search-fixtures";
import { expectNavigation } from "./fixtures/navigation-budget";
const detailAddress = "0x2222222222222222222222222222222222222222";
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Expected a visible control");
  return rect;
}

for (const mode of ["exit-only", "off", "unknown", "unavailable"] as const) {
  for (const width of [390, 1280]) test(`asset search fails closed for Invest ${mode} at ${width}px while owned exits remain`, async ({ page }) => {
    await seedSignedInSession(page); await installApiFixtures(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.route((url) => url.pathname === "/home", async (route) => {
      const response = await route.fetch();
      const investMode = mode === "unavailable" ? "exit-only" : mode;
      const body = (await response.text()).replaceAll(String.raw`\"invest\":\"on\"`, String.raw`\"invest\":\"${investMode}\"`)
        .replaceAll(String.raw`\"source\":\"deployment\"`, String.raw`\"source\":\"${mode === "unavailable" ? "unavailable" : "saved"}\"`);
      await route.fulfill({ response, body });
    });
    let searchReads = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/invest/search") searchReads += 1; });
    await page.goto("/home?search=ORB");
    await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search assets", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Search assets" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true })).toHaveCount(0);
    expect(searchReads).toBe(0);
    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Investments / }).click();
    await expectNavigation(page, "/investments");
    await page.getByRole("button", { name: /^Bitcoin/ }).click();
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Bitcoin");
    await expectNavigation(page, /\/investments\/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf$/i);
  });
}

for (const close of ["Close", "Escape", "Back"] as const) test(`desktop Search is pointer and keyboard modal until ${close}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto("/home");
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Search assets" });
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const rail = page.locator("#desktop-rail");
  expect(await rail.evaluate((node) => !!node.closest('[inert][aria-hidden="true"]'))).toBe(true);
  const home = rail.locator("#home-rail-nav");
  await home.evaluate((node) => node.focus());
  await expect(input).toBeFocused();
  const rect = await box(home);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expectNavigation(page, /\/home\?search=$/);
  await expect(dialog).toBeVisible();
  await input.focus(); await input.press("Tab");
  const closeButton = dialog.getByRole("button", { name: "Close search" });
  await expect(closeButton).toBeFocused();
  await closeButton.press("Tab"); await expect(input).toBeFocused();
  await input.press("Shift+Tab"); await expect(closeButton).toBeFocused();
  if (close === "Close") await closeButton.click();
  else if (close === "Escape") await closeButton.press("Escape");
  else await page.goBack();
  await expect(opener).toBeFocused();
  expect(await rail.evaluate((node) => !!node.closest('[inert], [aria-hidden="true"]'))).toBe(false);
});

for (const takeFocus of [false, true]) test(`failed return refetch preserves cached results and scroll without taking ${takeFocus ? "user" : "surface"} focus`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  const { promise: returned, resolve: releaseReturn } = Promise.withResolvers<void>();
  let firstReads = 0;
  await page.route("**/api/invest/search?*", async (route) => {
    const offset = new URL(route.request().url()).searchParams.get("offset") ?? "0";
    if (offset !== "0") return route.fulfill({ status: 503, body: "Unavailable" });
    firstReads += 1;
    if (firstReads > 1) {
      await returned;
      return route.fulfill({ status: 503, body: "Unavailable" });
    }
    return json(route, { ...searchFixture("ORB"), nextOffset: 3 });
  });
  await page.setViewportSize({ width: 390, height: 260 }); await page.goto("/home");
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await input.fill("ORB");
  const results = page.getByRole("region", { name: "Search results" });
  const rows = results.getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  await results.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(results.getByText("More results couldn’t load.")).toBeVisible();
  const scroll = page.locator("[data-asset-search-scroll]");
  await scroll.evaluate((node) => { node.scrollTop = 70; });
  const savedScroll = await scroll.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);
  await rows.nth(1).click();
  await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/home\?search=ORB$/);
  try {
    await expect.poll(() => firstReads).toBe(2);
    if (takeFocus) await input.focus();
    const failedReturn = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/invest/search" && url.searchParams.get("q") === "ORB" && (url.searchParams.get("offset") ?? "0") === "0" && response.status() === 503;
    });
    releaseReturn();
    await (await failedReturn).finished();
    await expect(rows).toHaveCount(3);
    await expect(results.getByText("More results couldn’t load.")).toHaveCount(0);
    await expect(results.getByRole("button", { name: "Retry more" })).toHaveCount(0);
    await expect(results.getByRole("button", { name: "Load more", exact: true })).toBeVisible();
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(savedScroll);
    if (takeFocus) await expect(input).toBeFocused();
    else await expect(rows.nth(1)).toBeFocused();
  } finally {
    releaseReturn();
  }
});

test("asset search deep links cap an overlong query before loading results", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.goto(`/home?search=${"a".repeat(65)}`);
  await expect(page.getByRole("dialog", { name: "Search assets" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search assets" })).toHaveValue("a".repeat(64));
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.getByRole("status")).toHaveText("No results");
  await expect(results.getByText("Search unavailable", { exact: true })).toHaveCount(0);
  await expect(results.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) test(`floating asset search preserves its Home origin, detail return and history at ${viewport.width}px`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  let assetReads = 0;
  await page.route("**/api/invest/asset?*", (route) => { assetReads += 1; return json(route, assetResolutionFixture(new URL(route.request().url()).searchParams.get("assetId") ?? "")); });
  await page.setViewportSize(viewport); await page.goto("/home");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 120));
  const originY = await page.evaluate(() => scrollY);
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  await opener.click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(input).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Search assets" })).toBeVisible();
  await expect(page.locator("main[data-app-main-authenticated]")).toHaveAttribute("inert");
  await input.pressSequentially("ORB");
  await expect(input).toHaveValue("ORB");
  await expectNavigation(page, /\/home\?search=ORB$/);
  const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  await page.setViewportSize({ width: viewport.width, height: 260 });
  const scroll = page.locator("[data-asset-search-scroll]");
  await scroll.evaluate((node) => { node.scrollTop = 70; });
  const savedScroll = await scroll.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);
  await rows.nth(1).click();
  await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  await expect(page.locator("[data-shell-header-title]")).toContainText("Orbit");
  await expect.poll(async () => {
    const detailState: unknown = await page.evaluate(() => {
      const state: unknown = history.state;
      return state;
    });
    return isRecord(detailState) ? detailState.investDetailFrom : null;
  }).toBe("search");
  expect(assetReads).toBe(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/home\?search=ORB$/);
  await expect(input).toHaveValue("ORB"); await expect(rows).toHaveCount(3);
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(savedScroll);
  await expect(rows.nth(1)).toBeFocused();
  await page.goForward(); await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  await page.goBack(); await expectNavigation(page, /\/home\?search=ORB$/);
  await expect(input).toHaveValue("ORB"); await expect(rows).toHaveCount(3);
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(savedScroll);
  await expect(rows.nth(1)).toBeFocused();
  await page.goForward(); await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  await page.reload(); await expect(page.locator("[data-shell-header-title]")).toContainText("Orbit");
  await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  expect(await page.evaluate(() => {
    const state: unknown = history.state;
    if (!state || typeof state !== "object") return null;
    return { from: "investDetailFrom" in state ? state.investDetailFrom : null, query: "assetSearchDetailQuery" in state ? state.assetSearchDetailQuery : null, hash: location.hash };
  })).toEqual({ from: "search", query: "ORB", hash: "" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/home\?search=ORB$/);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toBeFocused();
  await page.reload(); await expect(input).toHaveValue("ORB"); await expect(input).not.toBeFocused();
  await expect(rows).toHaveCount(3);
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "Clear search" }).click(); await expect(input).toBeFocused();
  await expect(input).toHaveValue(""); await expect(page.getByRole("region", { name: "Search results" })).toHaveCount(0);
  await expectNavigation(page, /\/home\?search=$/);
  await page.getByRole("button", { name: "Close search" }).click(); await expectNavigation(page, /\/home$/);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originY);
  await page.goForward(); await expect(input).toBeVisible();
  await input.press("Escape"); await expect(opener).toBeFocused();
});

for (const closeSearch of ["Escape", "Close", "Back"] as const) test(`asset search field shares the navigation gap and restores keyboard-hidden focus after ${closeSearch}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture("ORB")));
  await page.setViewportSize({ width: 320, height: 640 }); await page.goto("/home");
  const nav = page.locator('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
  const pill = await box(nav);
  const restingGap = 640 - pill.y - pill.height;
  const opener = page.getByRole("button", { name: "Search assets" });
  const circle = await box(opener);
  expect(pill.x).toBe(16); expect(320 - circle.x - circle.width).toBe(16); expect(circle.y).toBe(pill.y);
  await opener.click(); const input = page.getByRole("textbox", { name: "Search assets" }); await input.fill("ORB");
  const close = await box(page.getByRole("button", { name: "Close search" }));
  expect(close.x).toBe(circle.x); expect(close.y).toBe(circle.y);
  await expect.poll(async () => (await box(page.getByRole("search"))).x).toBe(16);
  const field = await box(page.getByRole("search"));
  expect(close.x - field.x - field.width).toBe(8); expect(field.height).toBe(62);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: field.x + field.width / 2, y: field.y + 4 })).toBe("INPUT");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ })).toHaveCount(3);
  await page.evaluate(() => { const viewport = visualViewport; if (!viewport) throw new Error("Expected visual viewport"); Object.defineProperty(viewport, "height", { configurable: true, value: 340 }); viewport.dispatchEvent(new Event("resize")); });
  await expect(page.locator("html")).toHaveAttribute("data-shell-keyboard", "open");
  await expect.poll(async () => { const bar = await box(page.locator("[data-asset-search-bar]")); return 340 - bar.y - bar.height; }).toBeCloseTo(restingGap, 0);
  await page.locator("[data-asset-search-scroll]").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const last = await box(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ }).last());
  expect(last.y + last.height).toBeLessThan((await box(page.locator("[data-asset-search-bar]"))).y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (closeSearch === "Escape") await input.press("Escape");
  else if (closeSearch === "Close") await page.getByRole("button", { name: "Close search" }).click();
  else await page.goBack();
  await expect(opener).toBeFocused();
  await expect(page.locator("html")).not.toHaveAttribute("data-shell-keyboard", "open");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`asset search animates keyboard height but corrects viewport pan immediately with ${reducedMotion}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/home");
  await page.getByRole("button", { name: "Search assets" }).click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(input).toBeFocused();
  const sample = await page.locator("[data-asset-search-bar]").evaluate(async (bar) => {
    const viewport = visualViewport;
    if (!viewport) throw new Error("Expected visual viewport");
    const bottom = () => bar.getBoundingClientRect().bottom;
    const resting = bottom();
    Object.defineProperties(viewport, { height: { configurable: true, value: 508 }, offsetTop: { configurable: true, value: 0 } });
    viewport.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    bottom();
    const lift = bar.getAnimations().find((animation) => animation instanceof CSSTransition && animation.transitionProperty === "transform");
    if (lift) { lift.pause(); lift.currentTime = 125; }
    const middle = bottom();
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 100 });
    viewport.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const panned = bottom();
    lift?.finish();
    const settled = bottom();
    return { resting, middle, panned, settled, animated: !!lift };
  });
  if (reducedMotion === "reduce") {
    expect(sample.animated).toBe(false);
    expect(sample.resting - sample.middle).toBeCloseTo(336, 0);
  } else {
    expect(sample.animated).toBe(true);
    expect(sample.resting - sample.middle).toBeGreaterThan(1);
    expect(sample.resting - sample.middle).toBeLessThan(335);
  }
  expect(sample.panned - sample.middle).toBeCloseTo(100, 0);
  expect(sample.resting - sample.settled).toBeCloseTo(236, 0);
  await expect(input).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-shell-keyboard", "open");
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`search close mid-enter and immediate reopen preserve focus with ${reducedMotion}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/home");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Search assets" })).toBeVisible();
  const state = await page.evaluate(async () => {
    const opener = [...document.querySelectorAll<HTMLButtonElement>("[data-shell-search-opener]")].find((button) => button.getClientRects().length > 0);
    if (!opener) throw new Error("Expected search opener");
    opener.click();
    const first = document.querySelector<HTMLInputElement>('input[aria-label="Search assets"]');
    const focusedInsideTap = document.activeElement === first;
    const closed = new Promise<void>((resolve) => window.addEventListener("popstate", () => requestAnimationFrame(() => resolve()), { once: true }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')?.click();
    await closed;
    const exit = document.querySelector("#asset-search-surface");
    const exitingIsInert = !exit || (exit.hasAttribute("inert") && exit.getAttribute("aria-hidden") === "true");
    const next = [...document.querySelectorAll<HTMLButtonElement>("[data-shell-search-opener]")].find((button) => button.getClientRects().length > 0);
    if (!next) throw new Error("Expected restored opener");
    const restoredFocus = document.activeElement === next;
    next.click();
    const reopened = document.querySelector<HTMLInputElement>('input[aria-label="Search assets"]');
    return { focusedInsideTap, exitingIsInert, restoredFocus, reopenedFocus: document.activeElement === reopened, value: reopened?.value };
  });
  expect(state).toEqual({ focusedInsideTap: true, exitingIsInert: true, restoredFocus: true, reopenedFocus: true, value: "" });
  const input = page.getByRole("textbox", { name: "Search assets" });
  await input.pressSequentially("ORB"); await expect(input).toHaveValue("ORB");
  await expectNavigation(page, /\/home\?search=ORB$/);
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ })).toHaveCount(3);
  const settledReopen = await page.evaluate(async () => {
    const closed = new Promise<void>((resolve) => window.addEventListener("popstate", () => requestAnimationFrame(() => resolve()), { once: true }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')?.click();
    await closed;
    [...document.querySelectorAll<HTMLButtonElement>("[data-shell-search-opener]")].find((button) => button.getClientRects().length > 0)?.click();
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Search assets"]');
    return { value: field?.value, focused: document.activeElement === field, search: location.search };
  });
  expect(settledReopen).toEqual({ value: "", focused: true, search: "?search=" });
  await expect(input).toHaveValue("");
  await expect(page.getByRole("region", { name: "Search results" })).toHaveCount(0);
  await expectNavigation(page, /\/home\?search=$/);
  await input.pressSequentially("B"); await expect(input).toHaveValue("B");
  await input.pressSequentially("TC"); await expect(input).toHaveValue("BTC");
  await expectNavigation(page, /\/home\?search=BTC$/);
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Bitcoin/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Orbit/ })).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.goBack(); await expect(page.getByRole("button", { name: "Search assets" })).toBeFocused();
  await page.goForward(); await expect(input).toBeVisible(); await expect(input).not.toBeFocused();
});
