import { expect, test, type Locator } from "@playwright/test";
import { isRecord } from "@/shared/guards";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { assetResolutionFixture, searchFixture } from "./feature-map/search-fixtures";
import { expectNavigation } from "./fixtures/navigation-budget";
import { waitForShellHydration } from "./fixtures/shell-hydration";
import { installRiskMarketFixtures, tokenRiskStatsFixture } from "./fixtures/token-risk";
const detailAddress = "0x2222222222222222222222222222222222222222";
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Expected a visible control");
  return rect;
}

async function expectSearchSettled(field: Locator) {
  await expect.poll(() => field.evaluate(async (node) => {
    const bar = node.closest("[data-asset-search-bar]");
    if (!bar) throw new Error("Expected the Search bar");
    await new Promise(requestAnimationFrame);
    await Promise.allSettled(bar.getAnimations({ subtree: true }).map((animation) => animation.finished));
    return bar.getAttribute("data-search-morph") === "open"
      && bar.getAnimations({ subtree: true }).every((animation) => animation.playState === "finished");
  })).toBe(true);
}

for (const root of [14, 16, 32]) for (const dir of ["ltr", "rtl"]) for (const reducedMotion of ["no-preference", "reduce"] as const) test(`Search chrome cannot scroll during immediate entry typing at ${root}px in ${dir} with ${reducedMotion}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion });
  await page.goto("/home"); await waitForShellHydration(page);
  await page.evaluate(({ root, dir }) => {
    document.documentElement.style.fontSize = `${root}px`; document.documentElement.dir = dir;
    const holdEntry = (event: TransitionEvent) => {
      if (!(event.target instanceof Element)) return;
      const bar = event.target.closest("[data-asset-search-bar]");
      if (!bar) return;
      document.removeEventListener("transitionrun", holdEntry);
      for (const animation of bar.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 0; }
      bar.setAttribute("data-test-entry-held", "true");
    };
    document.addEventListener("transitionrun", holdEntry);
  }, { root, dir });
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(input).toBeFocused();
  if (reducedMotion === "no-preference") await expect(page.locator("[data-asset-search-bar]")).toHaveAttribute("data-test-entry-held", "true");
  const ancestorOffsets = () => input.evaluate((node) => {
    const offsets = [];
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) offsets.push(ancestor.scrollLeft);
    return offsets;
  });
  const expectChromeUnscrolled = async () => {
    const offsets = await ancestorOffsets();
    expect(offsets).toEqual(offsets.map(() => 0));
  };
  await expectChromeUnscrolled();
  await input.pressSequentially("O"); await expect(input).toHaveValue("O"); await expectChromeUnscrolled();
  await input.fill("ORB"); await expect(input).toHaveValue("ORB"); await expectChromeUnscrolled();
  if (reducedMotion === "no-preference") await page.locator("[data-asset-search-bar]").evaluate((bar) => {
    for (const animation of bar.getAnimations({ subtree: true })) animation.currentTime = 100;
  });
  await input.pressSequentially("I"); await expect(input).toHaveValue("ORBI"); await expectChromeUnscrolled();
  await input.dispatchEvent("compositionstart", { data: "" });
  await page.keyboard.insertText("日"); await expect(input).toHaveValue("ORBI日"); await expectChromeUnscrolled();
  await input.dispatchEvent("compositionend", { data: "日" });
  await expectChromeUnscrolled();
  await page.locator("[data-asset-search-bar]").evaluate((bar) => { for (const animation of bar.getAnimations({ subtree: true })) animation.play(); });
  await expectSearchSettled(page.getByRole("search")); await expectChromeUnscrolled();
  await input.fill("a".repeat(100)); await input.press("End"); await expectChromeUnscrolled();
  await input.fill("ORB"); await expectNavigation(page, /\/home\?search=ORB$/); await expectChromeUnscrolled();
  await page.getByRole("button", { name: "Close search" }).click();
});

for (const rootFontSize of ["14px", "200%"]) for (const width of [320, 390]) for (const reducedMotion of ["no-preference", "reduce"] as const) test(`scaled-text Search keeps a usable nonblank field and controls at ${width}px with ${rootFontSize} and ${reducedMotion}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ reducedMotion });
  await page.goto("/home");
  await waitForShellHydration(page);
  await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, rootFontSize);
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  const input = page.getByRole("textbox", { name: "Search assets" });
  const clear = page.getByRole("button", { name: "Clear search" });
  const close = page.getByRole("button", { name: "Close search" });
  await opener.click(); await expect(input).toBeFocused();
  await input.pressSequentially("ORB"); await expect(input).toHaveValue("ORB");
  await expectNavigation(page, /\/home\?search=ORB$/);
  const field = page.getByRole("search");
  await expectSearchSettled(field);
  const inputFont = await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(inputFont).toBeGreaterThanOrEqual(16);
  expect(inputFont).toBe(rootFontSize === "14px" ? 16 : 34);
  await expect.poll(() => input.evaluate((node) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Expected text measurement support");
    const style = getComputedStyle(node); context.font = `${style.fontSize} ${style.fontFamily}`;
    return node.getBoundingClientRect().width / context.measureText("0").width;
  })).toBeGreaterThanOrEqual(3);
  expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(1);
  for (const control of [clear, close]) {
    const rect = await box(control);
    expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(await control.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return [rect.y + rect.height / 2, rect.bottom - .5].every((y) => node.contains(document.elementFromPoint(rect.x + rect.width / 2, y)));
    })).toBe(true);
  }
  expect((await box(field)).height).toBe(rootFontSize === "14px" ? 44 : 96);
  expect((await box(close)).height).toBe(rootFontSize === "14px" ? 44 : 48);
  if (rootFontSize === "200%") {
    expect((await box(input)).width).toBe(width === 320 ? 104 : 174);
    expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBe(34);
  }
  await expect.poll(() => field.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const parts = [...node.querySelectorAll("input, button, svg")].map((part) => part.getBoundingClientRect());
    const slots = [...node.querySelectorAll("input, button, svg")].filter((part) => !part.closest("button") || part.matches("button")).map((part) => part.getBoundingClientRect());
    return parts.every((part) => part.left >= bounds.left - .01 && part.right <= bounds.right + .01 && part.top >= bounds.top - .01 && part.bottom <= bounds.bottom + .01)
      && slots.every((part, index) => slots.slice(index + 1).every((other) => part.right <= other.left + .01 || part.left >= other.right - .01));
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const result = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ }).first();
  await result.click(); await expectNavigation(page, /\/invest\/base:/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(input).toHaveValue("ORB"); await expect(result).toBeFocused();
  await clear.click(); await expect(input).toHaveValue(""); await expect(input).toBeFocused();
  await input.pressSequentially("ORB"); await close.click(); await expect(opener).toBeFocused();
  await opener.click(); await expect(input).toBeFocused(); await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Back", exact: true }).click(); await expect(opener).toBeFocused();
});

for (const root of [14, 16, 32]) for (const dir of ["ltr", "rtl"]) test(`Search morph meets its opener at ${root}px root in ${dir}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/home");
  await waitForShellHydration(page);
  await page.evaluate(({ root, dir }) => { document.documentElement.style.fontSize = `${root}px`; document.documentElement.dir = dir; }, { root, dir });
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  const origin = await box(opener);
  expect(origin.height).toBe(Math.max(root * 3.25, 44 + root * .5));
  expect(origin.width).toBe(origin.height);
  await opener.click(); await expect(page.getByRole("textbox", { name: "Search assets" })).toBeFocused();
  const field = page.getByRole("search");
  await expectSearchSettled(field);
  expect((await box(field)).height).toBe(Math.max(root * 3, 44));
  expect((await box(page.getByRole("button", { name: "Close search" }))).height).toBe(Math.min(Math.max(root * 3, 44), 48));
  const endpoint = await field.evaluate(async (node, dir) => {
    const bar = node.closest("[data-asset-search-bar]");
    const glass = node.querySelector(":scope > span:nth-child(2) > span");
    if (!bar || !glass) throw new Error("Expected the rendered Search morph");
    bar.setAttribute("data-search-morph", "closed");
    await new Promise(requestAnimationFrame);
    for (const animation of bar.getAnimations({ subtree: true })) {
      animation.pause();
      if (animation.effect) animation.currentTime = Number(animation.effect.getTiming().duration);
    }
    const bounds = node.getBoundingClientRect();
    const cap = glass.getBoundingClientRect();
    return { x: dir === "rtl" ? cap.left : cap.right - bounds.height, y: bounds.y, width: bounds.height, height: bounds.height };
  }, dir);
  for (const key of ["x", "y", "width", "height"] as const) expect(endpoint[key]).toBeCloseTo(origin[key], 4);
});

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
    await waitForShellHydration(page);
    await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search assets", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Search", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Invest", exact: true })).toHaveCount(0);
    expect(searchReads).toBe(0);
    await page.getByRole("region", { name: "Your money" }).getByRole("button", { name: /^Investments / }).click();
    await expectNavigation(page, "/investments");
    await page.getByRole("button", { name: /^Bitcoin/ }).click();
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Bitcoin");
    await expectNavigation(page, /\/investments\/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf$/i);
  });
}

for (const close of ["Close", "Escape", "Back"] as const) test(`desktop Search shares the reachable shell header until ${close}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto("/home");
  await waitForShellHydration(page);
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  await opener.click();
  const surface = page.getByRole("region", { name: "Search", exact: true });
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(surface).not.toHaveAttribute("aria-modal");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const rail = page.locator("#desktop-rail");
  expect(await rail.evaluate((node) => !!node.closest('[inert][aria-hidden="true"]'))).toBe(true);
  const home = rail.locator("#home-rail-nav");
  await home.evaluate((node) => node.focus());
  await expect(input).toBeFocused();
  const headerBack = page.getByRole("button", { name: "Back", exact: true });
  await input.press("Shift+Tab");
  expect(await page.getByRole("banner").evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await headerBack.focus(); await expect(headerBack).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
  const header = await box(page.getByRole("banner"));
  expect((await box(surface)).y).toBeGreaterThanOrEqual(header.y + header.height);
  await expectSearchSettled(page.getByRole("search"));
  expect((await box(page.getByRole("search"))).height).toBe(52);
  expect((await box(surface.getByRole("button", { name: "Close search" }))).height).toBe(52);
  if (close === "Close") await surface.getByRole("button", { name: "Close search" }).click();
  else if (close === "Escape") await input.press("Escape");
  else await headerBack.click();
  await expect(opener).toBeFocused();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
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
  await waitForShellHydration(page);
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

for (const width of [390, 1280]) for (const takeFocus of ["none", "header", "input"] as const) test(`cold Search return restores scroll with ${takeFocus} focus during a held response at ${width}px`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/asset?*", (route) => json(route, assetResolutionFixture(new URL(route.request().url()).searchParams.get("assetId") ?? "")));
  const { promise: returned, resolve: releaseReturn } = Promise.withResolvers<void>();
  let searchReads = 0;
  await page.route("**/api/invest/search?*", async (route) => {
    searchReads += 1;
    if (searchReads > 1) await returned;
    return json(route, searchFixture("ORB"));
  });
  await page.setViewportSize({ width, height: width === 390 ? 260 : 320 }); await page.goto("/home");
  await waitForShellHydration(page);
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await input.fill("ORB");
  const surface = page.getByRole("region", { name: "Search", exact: true });
  const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  const scroll = page.locator("[data-asset-search-scroll]");
  await scroll.evaluate((node) => { node.scrollTop = 70; });
  const savedScroll = await scroll.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(0);
  await rows.nth(1).click();
  await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
  await page.reload();
  await waitForShellHydration(page);
  await expect(page.locator("[data-shell-header-title]")).toContainText("Orbit");
  const headerBack = page.getByRole("button", { name: "Back", exact: true });
  await headerBack.click();
  try {
    await expectNavigation(page, /\/home\?search=ORB$/);
    await expect.poll(() => searchReads).toBe(2);
    await expect(rows).toHaveCount(0);
    await expect(surface).toBeFocused();
    if (takeFocus === "header") {
      for (let tabs = 0; tabs < 4 && !await headerBack.evaluate((node) => node === document.activeElement); tabs += 1) await page.keyboard.press("Shift+Tab");
      await expect(headerBack).toBeFocused();
      expect(await surface.evaluate((node) => node.contains(document.activeElement))).toBe(false);
    } else if (takeFocus === "input") {
      await input.focus();
      await expect(input).toBeFocused();
    }
    const successfulReturn = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/invest/search" && response.status() === 200);
    releaseReturn();
    await (await successfulReturn).finished();
    await expect(rows).toHaveCount(3);
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(savedScroll);
    if (takeFocus === "header") await expect(headerBack).toBeFocused();
    else if (takeFocus === "input") await expect(input).toBeFocused();
    else await expect(rows.nth(1)).toBeFocused();
  } finally {
    releaseReturn();
  }
});

test("asset search deep links cap an overlong query before loading results", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.goto(`/home?search=${"a".repeat(65)}`);
  await waitForShellHydration(page);
  await expect(page.getByRole("region", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
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
  await waitForShellHydration(page);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("session:verified", "mark").length)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 120));
  const originY = await page.evaluate(() => scrollY);
  const opener = page.getByRole("button", { name: "Search assets", exact: true });
  await opener.click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  await expect(input).toBeFocused();
  await expect(page.getByRole("region", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(page.locator("main[data-app-main-authenticated]")).not.toHaveAttribute("inert");
  await expect(page.locator("#navigation-panel")).toBeHidden();
  await input.pressSequentially("ORB");
  await expect(input).toHaveValue("ORB");
  await expectNavigation(page, /\/home\?search=ORB$/);
  const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  await page.setViewportSize({ width: viewport.width, height: viewport.width >= 1024 ? 320 : 240 });
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
  await page.reload(); await waitForShellHydration(page); await expect(page.locator("[data-shell-header-title]")).toContainText("Orbit");
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
  await page.reload(); await waitForShellHydration(page); await expect(input).toHaveValue("ORB"); await expect(input).not.toBeFocused();
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
  await waitForShellHydration(page);
  const nav = page.locator('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
  const pill = await box(nav);
  const restingGap = 640 - pill.y - pill.height;
  const opener = page.getByRole("button", { name: "Search assets" });
  const circle = await box(opener);
  expect(pill.x).toBe(21); expect(320 - circle.x - circle.width).toBe(21); expect(circle.y).toBe(pill.y);
  await opener.click(); const input = page.getByRole("textbox", { name: "Search assets" }); await input.fill("ORB");
  const close = await box(page.getByRole("button", { name: "Close search" }));
  expect(close.x).toBe(circle.x + 2); expect(close.y).toBe(circle.y + 2);
  await expect.poll(async () => (await box(page.getByRole("search"))).x).toBe(23);
  const field = await box(page.getByRole("search"));
  expect(close.x - field.x - field.width).toBe(12); expect(field.height).toBe(48);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, { x: field.x + field.width / 2, y: field.y + 4 })).toBe("INPUT");
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ })).toHaveCount(3);
  await page.evaluate(() => { const viewport = visualViewport; if (!viewport) throw new Error("Expected visual viewport"); Object.defineProperty(viewport, "height", { configurable: true, value: 340 }); viewport.dispatchEvent(new Event("resize")); });
  await expect(page.locator("html")).toHaveAttribute("data-shell-keyboard", "open");
  await expect.poll(async () => { const bar = await box(page.locator("[data-asset-search-bar]")); return 340 - bar.y - bar.height; }).toBeCloseTo(restingGap + 2, 0);
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
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture("ORB")));
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/home");
  await waitForShellHydration(page);
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
  await input.fill("ORB");
  const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
  await expect(rows).toHaveCount(3);
  const back = page.getByRole("banner").getByRole("button", { name: "Back", exact: true });
  for (const { height, offsetTop } of [{ height: 508, offsetTop: 100 }, { height: 384, offsetTop: 340 }, { height: 844, offsetTop: 0 }, { height: 384, offsetTop: 340 }, { height: 844, offsetTop: 0 }]) {
    await page.evaluate(({ height, offsetTop }) => {
      if (!visualViewport) throw new Error("Expected visual viewport");
      Object.defineProperties(visualViewport, { height: { configurable: true, value: height }, offsetTop: { configurable: true, value: offsetTop } });
      visualViewport.dispatchEvent(new Event("resize"));
      visualViewport.dispatchEvent(new Event("scroll"));
    }, { height, offsetTop });
    await expect.poll(() => page.getByRole("banner").evaluate((node) => node.getBoundingClientRect().top)).toBe(offsetTop);
    const header = await box(page.getByRole("banner"));
    const backBounds = await box(back);
    expect(header.y).toBeGreaterThanOrEqual(offsetTop);
    expect(header.y + header.height).toBeLessThanOrEqual(offsetTop + height);
    expect(backBounds.y).toBeGreaterThanOrEqual(offsetTop);
    expect(backBounds.y + backBounds.height).toBeLessThanOrEqual(offsetTop + height);
    expect(await back.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const viewport = visualViewport;
      if (!viewport) throw new Error("Expected visual viewport");
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return x >= viewport.offsetLeft && x <= viewport.offsetLeft + viewport.width && y >= viewport.offsetTop && y <= viewport.offsetTop + viewport.height && (node === hit || node.contains(hit));
    })).toBe(true);
    const scroll = page.locator("[data-asset-search-scroll]");
    const scrollBounds = await box(scroll);
    expect(scrollBounds.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(scrollBounds.y + scrollBounds.height).toBeLessThanOrEqual(offsetTop + height + 1);
    await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect.poll(async () => {
      const row = await box(rows.last());
      const bar = await box(page.locator("[data-asset-search-bar]"));
      return row.y >= header.y + header.height && row.y + row.height <= bar.y;
    }).toBe(true);
    await back.focus();
    await expect(back).toBeFocused();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => page.getByRole("banner").evaluate((node) => node.getBoundingClientRect().top)).toBe(offsetTop);
    await input.focus();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
  }
  await back.click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  expect((await box(page.getByRole("banner"))).y).toBe(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`search close mid-enter and immediate reopen preserve focus with ${reducedMotion}`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.emulateMedia({ reducedMotion });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/home");
  await waitForShellHydration(page);
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

for (const width of [320, 390, 1280]) test(`Search header remains reachable through keyboard and IME at ${width}px`, async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture(new URL(route.request().url()).searchParams.get("q") ?? "")));
  await page.setViewportSize({ width, height: 844 }); await page.goto("/home");
  await waitForShellHydration(page);
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search assets" });
  const header = page.getByRole("banner");
  const back = header.getByRole("button", { name: "Back", exact: true });
  await expect(input).toBeFocused();
  await input.dispatchEvent("compositionstart");
  await input.fill("ORB");
  await input.press("Escape");
  await expect(input).toHaveValue("ORB");
  await expectNavigation(page, /\/home\?search=$/);
  await expect(page.getByRole("region", { name: "Search results" }).getByRole("status")).toHaveText("Loading results");
  await expect(page.getByRole("button", { name: /Orbit/ })).toHaveCount(0);
  await input.dispatchEvent("compositionend");
  await expectNavigation(page, /\/home\?search=ORB$/);
  await expect(page.getByRole("button", { name: /Orbit/ })).toHaveCount(3);
  for (const height of [508, 844, 508]) {
    await input.focus();
    await page.evaluate((height) => {
      if (!visualViewport) throw new Error("Expected visual viewport");
      Object.defineProperty(visualViewport, "height", { configurable: true, value: height });
      visualViewport.dispatchEvent(new Event("resize"));
    }, height);
    if (height === 508) await expect(page.locator("html")).toHaveAttribute("data-shell-keyboard", "open");
    else await expect(page.locator("html")).not.toHaveAttribute("data-shell-keyboard", "open");
    await expect(header.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
    expect((await box(header)).y).toBe(0);
    await back.focus(); await expect(back).toBeFocused();
    expect(await back.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
  }
  await back.click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("configured DEGEN recovers Token checks without losing its chart or Back origin", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page); await installRiskMarketFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, {
    version: 1, query: "DEGEN", offset: 0, results: [{ kind: "configured", assetId: "degen", match: "exact" }],
    snapshots: [], provider: "ok", coverage: "complete", nextOffset: null,
  }));
  let recovering = false;
  await page.route("**/api/market-prices/stats?*", (route) => !recovering
    ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    : json(route, tokenRiskStatsFixture("degen", { transferPausable: "reported" })));
  await page.goto("/home");
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  await page.getByRole("textbox", { name: "Search assets" }).fill("DEGEN");
  const result = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /^Degen/ });
  await result.click(); await expectNavigation(page, /\/invest\/degen$/);
  const risk = page.getByRole("region", { name: "Token checks" });
  const chart = page.getByRole("group", { name: /^1 week price history/ });
  await expect(risk.getByRole("status")).toContainText("Couldn't check this token");
  await expect(chart).toBeVisible();
  const trigger = risk.getByRole("button", { name: /Token checks/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(risk.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  recovering = true;
  await risk.getByRole("button", { name: "Try again" }).click();
  await expect(risk.getByText(/^Reported by GoPlus · checked/)).toBeVisible();
  await expect(risk.getByText("Transfers can be paused", { exact: true })).toBeVisible();
  await expect(risk.getByText("No data: transfer tax", { exact: true })).toBeVisible();
  await expect(chart).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectNavigation(page, /\/home\?search=DEGEN$/); await expect(result).toBeFocused();
});

test("admitted Base deep links keep same-symbol checks bound to each contract", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page); await installRiskMarketFixtures(page);
  await page.route("**/api/invest/asset?*", (route) => json(route,
    assetResolutionFixture(new URL(route.request().url()).searchParams.get("assetId") ?? "")));
  await page.route("**/api/market-prices/stats?*", (route) => {
    const assetId = new URL(route.request().url()).searchParams.get("assetId") ?? "";
    return json(route, tokenRiskStatsFixture(assetId, assetId.endsWith(detailAddress)
      ? { blacklist: "reported" } : { honeypot: "reported" }));
  });
  for (const [address, own, other] of [
    ["0x1111111111111111111111111111111111111111", "May not be sellable", "Addresses can be blocked"],
    [detailAddress, "Addresses can be blocked", "May not be sellable"],
  ]) {
    await page.goto(`/invest/base:${address}`); await expectNavigation(page, new RegExp(`/invest/base:${address}$`));
    await expect(page.locator("[data-shell-header-title]").first()).toHaveText("Orbit");
    const risk = page.getByRole("region", { name: "Token checks" });
    const trigger = risk.getByRole("button", { name: /Token checks/ });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(risk.getByText(/^Reported by GoPlus · checked/)).toBeVisible();
    await expect(risk.getByText(own, { exact: true })).toBeVisible();
    await expect(risk.getByText(other, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /^1 week price history/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "View contract", exact: true })).toHaveAttribute("href", `https://basescan.org/token/${address}`);
  }
});

test("exact-address fallback reads advisory checks for an unadmitted contract", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page); await installRiskMarketFixtures(page);
  const assetId = `base:${detailAddress}`;
  await page.route("**/api/invest/asset?*", (route) => json(route, {
    version: 1, assetId, provider: "error", asset: null, source: null, snapshot: null,
  }));
  await page.route("**/api/market-prices/stats?*", (route) => json(route,
    tokenRiskStatsFixture(assetId, { cannotSellAll: "reported" }, "unavailable")));
  await page.goto(`/invest/${assetId}`); await expectNavigation(page, new RegExp(`/invest/${assetId}$`));
  const risk = page.getByRole("region", { name: "Token checks" });
  await risk.getByRole("button", { name: /Token checks/ }).click();
  await expect(risk.getByText(/^Reported by GoPlus · checked/)).toBeVisible();
  await expect(risk.getByText("Sell limit", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View contract", exact: true })).toHaveAttribute("href", `https://basescan.org/token/${detailAddress}`);
  await expect(page.getByRole("region", { name: "Market price history" })).toHaveCount(0);
});

test("late Token checks for A never replace B after search navigation", async ({ page }) => {
  await seedSignedInSession(page); await installApiFixtures(page); await installRiskMarketFixtures(page);
  await page.route("**/api/invest/search?*", (route) => json(route, searchFixture("ORB")));
  const firstAddress = "0x1111111111111111111111111111111111111111";
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const { promise: observed, resolve: observe } = Promise.withResolvers<void>();
  const { promise: delivered, resolve: deliver } = Promise.withResolvers<void>();
  await page.route("**/api/market-prices/stats?*", async (route) => {
    const assetId = new URL(route.request().url()).searchParams.get("assetId") ?? "";
    if (assetId === `base:${firstAddress}`) { observe(); await held; }
    await json(route, tokenRiskStatsFixture(assetId, assetId === `base:${firstAddress}`
      ? { honeypot: "reported" } : { blacklist: "reported" }));
    if (assetId === `base:${firstAddress}`) deliver();
  });
  try {
    await page.goto("/home?search=ORB");
    const rows = page.getByRole("region", { name: "Search results" }).getByRole("button", { name: /Orbit/ });
    await expect(rows).toHaveCount(3); await rows.nth(0).click();
    await expectNavigation(page, new RegExp(`/invest/base:${firstAddress}$`)); await observed;
    await expect(page.getByRole("region", { name: "Token checks" }).getByRole("status")).toHaveText("Checking token");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expectNavigation(page, /\/home\?search=ORB$/); await expect(rows.nth(0)).toBeFocused();
    await rows.nth(1).click(); await expectNavigation(page, new RegExp(`/invest/base:${detailAddress}$`));
    const risk = page.getByRole("region", { name: "Token checks" });
    const trigger = risk.getByRole("button", { name: /Token checks/ });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(risk.getByText("Addresses can be blocked", { exact: true })).toBeVisible();
    release(); await delivered;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(risk.getByText("May not be sellable", { exact: true })).toHaveCount(0);
    await expect(risk.getByText("Addresses can be blocked", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View contract", exact: true })).toHaveAttribute("href", `https://basescan.org/token/${detailAddress}`);
  } finally { release(); }
});
