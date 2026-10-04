import { expect, test, type Locator, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a visible element with a bounding box");
  return box;
}

for (const width of [390, 320]) {
  test(`mobile navigation clears the final Home content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)')!;
      const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]")!;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const lastContent = main.lastElementChild as HTMLElement;
      const { x, y, width, height, top, right, bottom, left } = nav.getBoundingClientRect();
      const searchControl = [...document.querySelectorAll<HTMLElement>("[data-shell-search-opener]")].find((control) => control.getBoundingClientRect().width > 0);
      const searchRect = searchControl?.getBoundingClientRect();
      return {
        nav: { x, y, width, height, top, right, bottom, left },
        contentBottom: lastContent.getBoundingClientRect().bottom,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        position: nav.parentElement ? getComputedStyle(nav.parentElement).position : null,
        search: searchRect ? { x: searchRect.x, y: searchRect.y, width: searchRect.width, height: searchRect.height, top: searchRect.top, right: searchRect.right, bottom: searchRect.bottom, left: searchRect.left } : null,
        tabHeights: Array.from(nav.querySelectorAll("button"), (button) => button.getBoundingClientRect().height),
      };
    });
    expect(geometry.position).toBe("fixed");
    expect(geometry.nav.width).toBe(192);
    expect(geometry.nav.height).toBe(62);
    expect(geometry.tabHeights).toEqual([54, 54]);
    expect(844 - geometry.nav.bottom).toBe(12);
    if (!geometry.search) throw new Error("Expected Search control");
    expect(Math.abs((geometry.nav.left + geometry.search.right) / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.nav.top);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  });

  test(`mobile navigation stays anchored during document scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect(page.getByText("Loading recent activity…")).toHaveCount(0);
    const boundary = async () => page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)')!;
      window.scrollTo(0, document.documentElement.scrollHeight);
      window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        pageScroll: window.scrollY,
        mainScrolls: document.documentElement.scrollHeight > window.innerHeight,
        navGap: window.innerHeight - nav.getBoundingClientRect().bottom,
      };
    });
    for (const height of [844, 700, 844]) {
      await page.setViewportSize({ width, height });
      const result = await boundary();
      expect(result.documentHeight).toBeGreaterThan(result.viewportHeight);
      expect(result.pageScroll).toBeGreaterThan(0);
      expect(result.mainScrolls).toBe(true);
      expect(result.navGap).toBe(12);
    }
  });
}

for (const route of ["/home", "/activity"]) {
  for (const theme of ["light", "dark"]) {
    test(`usable viewport geometry stays anchored on ${route} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await seedSignedInSession(page);
      await installApiFixtures(page);
      await page.addInitScript((appearance) => localStorage.setItem("home.appearance.v1", appearance), theme);
      await page.goto(route);
      const nav = page.locator('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
      await expect(nav).toBeVisible();
      for (const { height, offsetTop, scale } of [
        { height: 844, offsetTop: 0, scale: 1 },
        { height: 800, offsetTop: 0, scale: 1 },
        { height: 760, offsetTop: 20, scale: 1 },
        { height: 820, offsetTop: 0, scale: 1 },
        { height: 790, offsetTop: 24, scale: 1 },
        { height: 844, offsetTop: 0, scale: 1 },
      ]) {
        await page.evaluate((geometry) => {
          const viewport = window.visualViewport;
          if (!viewport) throw new Error("Expected a visual viewport");
          Object.defineProperties(viewport, {
            height: { configurable: true, value: geometry.height },
            offsetTop: { configurable: true, value: geometry.offsetTop },
            scale: { configurable: true, value: geometry.scale },
          });
          viewport.dispatchEvent(new Event("resize"));
          viewport.dispatchEvent(new Event("scroll"));
        }, { height, offsetTop, scale });
        await expect.poll(async () => nav.evaluate((element) => {
          return window.innerHeight - element.getBoundingClientRect().bottom;
        })).toBe(12);
      }
      const backgrounds = await page.evaluate(() => {
        const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]");
        if (!main) throw new Error("Expected authenticated main content");
        return [document.documentElement, document.body, main].map((element) => getComputedStyle(element).backgroundColor);
      });
      expect(backgrounds[0]).toBe(backgrounds[2]);
      expect(backgrounds[1]).toBe(backgrounds[2]);
      const clearance = await page.locator("[data-app-main-authenticated]").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
      expect(clearance).toBe(62 + 12 + 16);
    });
  }
}

test("shared keyboard geometry hides navigation and restores its resting gap without transform lag", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Country" });
  const nav = page.locator('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
  await expect(input).toBeVisible();
  await input.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Expected a visual viewport");
    Object.defineProperty(viewport, "height", { configurable: true, value: 544 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute("data-shell-keyboard", "open");
  await expect(nav).toHaveAttribute("aria-hidden", "true");
  await expect(nav).toHaveAttribute("inert");
  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) throw new Error("Expected a focused HTML element");
    activeElement.blur();
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("Expected a visual viewport");
    Object.defineProperty(viewport, "height", { configurable: true, value: 844 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).not.toHaveAttribute("data-shell-keyboard");
  await expect(nav).not.toHaveAttribute("aria-hidden");
  await expect(nav).not.toHaveAttribute("inert");
  await expect.poll(async () => nav.evaluate((element) => innerHeight - element.getBoundingClientRect().bottom)).toBe(12);
  expect(await nav.evaluate((element) => getComputedStyle(element).transitionProperty)).not.toContain("transform");
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }]) {
  test(`Home money and Activity scroll geometry at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/activity*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      const to = url.searchParams.get("to") ?? new Date(FIXED_NOW).toISOString();
      const wallet = sessionBody.smartAccount.address.toLowerCase();
      const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
      return json(route, {
        version: 1, walletAddress: wallet, chainId: 8453,
        currency: url.searchParams.get("currency") ?? "USD",
        window: { from: new Date(Date.parse(to) - 86_400_000).toISOString(), to },
        transfers: Array.from({ length: 16 }, (_, index) => ({
          id: `8453:${token}:home-grid-${index}`, logId: `home-grid-${index}`, chainId: 8453,
          assetId: "usdc", tokenAddress: token, tokenSymbol: "USDC", tokenDecimals: 6,
          tokenImageUrl: null, walletAddress: wallet,
          fromAddress: index % 2 ? wallet : "0x2222222222222222222222222222222222222222",
          toAddress: index % 2 ? "0x2222222222222222222222222222222222222222" : wallet,
          direction: index % 2 ? "outgoing" : "incoming", amountBaseUnits: "25000000",
          blockNumber: String(1000 - index), blockHash: `0x${"ef".repeat(32)}`,
          transactionHash: `0x${(index + 1).toString(16).padStart(64, "0")}`, logIndex: "1",
          blockTimestamp: new Date(Date.parse(to) - (index + 1) * 60 * 60_000).toISOString(),
          valuation: { status: "unpriced", currency: url.searchParams.get("currency") ?? "USD", reason: "quote-unavailable" },
        })),
        nextCursor: null,
        source: { provider: "cdp-sql", cached: false, stale: false, executionTimestamp: to, executionTimeMs: 1, fetchedAt: to },
      });
    });
    await page.goto("/home");
    const money = page.getByRole("region", { name: "Your money" }).locator("..");
    const activity = page.getByRole("region", { name: "Activity" }).locator("..");
    await expect(page.getByRole("region", { name: "Activity" })).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("region", { name: "Activity" }).getByRole("button", { name: /Received/ }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(300);
    const beforeMoney = await requiredBox(money);
    const beforeActivity = await requiredBox(activity);
    expect(beforeActivity.x).toBeGreaterThan(beforeMoney.x + beforeMoney.width);
    if (viewport.height >= 640) {
      expect(beforeMoney.width / beforeActivity.width).toBeGreaterThan(1.4);
      expect(beforeMoney.width / beforeActivity.width).toBeLessThan(1.6);
      expect(beforeMoney.height).toBeGreaterThan(0);
    }
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(190);
    if (viewport.height >= 640) {
      await expect.poll(async () => beforeActivity.y - (await requiredBox(activity)).y).toBeGreaterThan(150);
      expect(beforeMoney.y - (await requiredBox(money)).y).toBeLessThanOrEqual(80);
    } else {
      await expect.poll(async () => beforeMoney.y - (await requiredBox(money)).y).toBeGreaterThan(150);
    }
  });
}

test("the capsule covers widths through 1023px and the rail takes over at 1024px", async ({ page }) => {
  await page.setViewportSize({ width: 1023, height: 768 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((element) => element.parentElement ? getComputedStyle(element.parentElement).position : null)).toBe("fixed");
  expect(await nav.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(192);
  await expect(page.locator("#desktop-rail")).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("#desktop-rail")).toBeVisible();
  await expect(nav).toHaveCount(1);
  expect(await nav.evaluate((element) => element.closest("#desktop-rail") !== null)).toBe(true);
});

test("a drag does not swallow two immediate real taps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
  const home = nav.getByRole("button", { name: "Home" });
  const invest = nav.getByRole("button", { name: "Invest" });
  const homeBox = await requiredBox(home);
  const investBox = await requiredBox(invest);
  const center = (box: typeof homeBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await nav.evaluate((element) => {
    element.setAttribute("data-accepted-taps", "");
    element.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent) || !event.isTrusted || event.detail === 0 || !(event.target instanceof Element)) return;
      const tab = event.target.closest("button");
      if (tab) element.setAttribute("data-accepted-taps", `${element.getAttribute("data-accepted-taps")}${tab.id},`);
    });
  });
  const cdp = await page.context().newCDPSession(page);
  // oxlint-disable-next-line home/no-real-waits -- CDP input timestamps are read by the browser's real input pipeline, which no page clock controls.
  const timestamp = Date.now() / 1000;
  const dispatch = (type: "mouseMoved" | "mousePressed" | "mouseReleased", point: { x: number; y: number }, held = false) =>
    cdp.send("Input.dispatchMouseEvent", { type, ...point, button: type === "mouseMoved" ? "none" : "left", buttons: held ? 1 : 0, clickCount: 1, timestamp });
  await dispatch("mouseMoved", center(homeBox));
  await dispatch("mousePressed", center(homeBox), true);
  await dispatch("mouseMoved", center(investBox), true);
  await dispatch("mouseMoved", { x: center(investBox).x, y: investBox.y + investBox.height + 12 }, true);
  await dispatch("mouseReleased", { x: center(investBox).x, y: investBox.y + investBox.height + 12 });
  await dispatch("mouseMoved", center(homeBox));
  await dispatch("mousePressed", center(homeBox), true);
  await dispatch("mouseReleased", center(homeBox));
  await dispatch("mouseMoved", center(investBox));
  await dispatch("mousePressed", center(investBox), true);
  await dispatch("mouseReleased", center(investBox));
  await expect(nav).toHaveAttribute("data-accepted-taps", "home-nav,invest-nav,");
  await expect(invest).toHaveAttribute("aria-current", "page");
});

for (const { name, lift, selected } of [
  { name: "a hold that wanders vertically within reach selects the tab under the finger", lift: 40, selected: "Invest" },
  { name: "a hold released far outside the bar cancels back", lift: 160, selected: "Home" },
]) {
  test(name, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 120));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const scrolled = await page.evaluate(() => window.scrollY);
    const windowScroll = await page.evaluate(() => window.scrollY);
    const homeBox = await requiredBox(nav.getByRole("button", { name: "Home" }));
    const investBox = await requiredBox(nav.getByRole("button", { name: "Invest" }));
    const startX = homeBox.x + homeBox.width / 2;
    const startY = homeBox.y + homeBox.height / 2;
    const endX = investBox.x + investBox.width / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await touch("touchStart", startX, startY);
    await expect(nav).toHaveAttribute("data-lens-pressed", "");
    for (let step = 1; step <= 6; step += 1) await touch("touchMove", startX, startY - (160 * step) / 6);
    await expect(nav).toHaveAttribute("data-lens-pressed", "");
    for (let step = 1; step <= 6; step += 1) await touch("touchMove", startX + ((endX - startX) * step) / 6, startY - 160 + ((160 - lift) * step) / 6);
    await expect(nav).toHaveAttribute("data-lens-pressed", "");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    expect(await page.evaluate(() => window.scrollY)).toBe(windowScroll);
    await touch("touchEnd", endX, startY - lift);
    await expect(nav.getByRole("button", { name: selected })).toHaveAttribute("aria-current", "page");
    await expect(nav).not.toHaveAttribute("data-lens-pressed");
    await expect(nav).not.toHaveAttribute("data-lens-wide");
    await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
  });
}

for (const { name, beside, selected } of [
  { name: "a drag released just beside the capsule selects the nearest tab", beside: 16, selected: "Invest" },
  { name: "a drag released well beside the capsule cancels back", beside: 60, selected: "Home" },
]) {
  test(name, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
    const navBox = (await nav.boundingBox())!;
    const homeBox = await requiredBox(nav.getByRole("button", { name: "Home" }));
    const startX = homeBox.x + homeBox.width / 2;
    const y = homeBox.y + homeBox.height / 2;
    const endX = navBox.x + navBox.width + beside;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    await touch("touchStart", startX);
    await expect(nav).toHaveAttribute("data-lens-pressed", "");
    for (let step = 1; step <= 6; step += 1) await touch("touchMove", startX + ((endX - startX) * step) / 6);
    await touch("touchEnd", endX);
    await expect(nav.getByRole("button", { name: selected })).toHaveAttribute("aria-current", "page");
    await expect(nav).not.toHaveAttribute("data-lens-pressed");
    await expect(nav).not.toHaveAttribute("data-lens-wide");
  });
}

test("a tap released just past its tab edge keeps the lens on the tab the click selects", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const lens = nav.locator('[data-navigation-lens="ready"]');
  await expect(lens).toBeVisible();
  const investBox = await requiredBox(nav.getByRole("button", { name: "Invest" }));
  const startX = investBox.x + investBox.width - 3;
  const y = investBox.y + investBox.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", startX);
  await expect.poll(() => lens.evaluate((element) => element.style.transform)).toBe("translateX(100%)");
  await lens.evaluate((element) => {
    const seen: string[] = [];
    new MutationObserver(() => seen.push(element.style.transform)).observe(element, { attributeFilter: ["style"] });
    Object.assign(window, { lensPlaces: seen });
  });
  await touch("touchMove", startX + 5);
  await touch("touchEnd", startX + 5);
  await expect(nav.getByRole("button", { name: "Invest" })).toHaveAttribute("aria-current", "page");
  await expect(nav).not.toHaveAttribute("data-lens-pressed");
  await expect(nav).not.toHaveAttribute("data-lens-wide");
  await expect.poll(() => lens.evaluate((element) => element.style.transform)).toBe("translateX(100%)");
  expect(await page.evaluate(() => (window as unknown as { lensPlaces: string[] }).lensPlaces)).not.toContain("translateX(0%)");
});

test("a tap whose navigation commits late keeps the lens on the tapped tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "playwright" });
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const lens = nav.locator('[data-navigation-lens="ready"]');
  await expect(lens).toBeVisible();
  const invest = nav.getByRole("button", { name: "Invest" });
  const investBox = await requiredBox(invest);
  const point = { x: investBox.x + investBox.width / 2, y: investBox.y + investBox.height / 2 };
  await nav.evaluate((element) => {
    element.parentElement!.addEventListener("click", (event) => {
      const tab = event.target instanceof Element ? event.target.closest("button") : null;
      if (!event.isTrusted || !tab) return;
      event.stopPropagation();
      Object.assign(window, { commitNavigation: () => tab.click() });
    });
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchEnd") =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ ...point, id: 1 }] });
  await touch("touchStart");
  await expect.poll(() => settledLensTab(page)).toBe("invest-nav");
  await touch("touchEnd");
  await expect(nav).not.toHaveAttribute("data-lens-pressed");
  await expect.poll(() => page.evaluate(() => "commitNavigation" in window)).toBe(true);
  await page.clock.runFor(1_500);
  expect(await settledLensTab(page)).toBe("invest-nav");
  await expect(invest).not.toHaveAttribute("aria-current");
  await page.evaluate(() => (window as unknown as { commitNavigation: () => void }).commitNavigation());
  await expect(invest).toHaveAttribute("aria-current", "page");
  expect(await settledLensTab(page)).toBe("invest-nav");
});

test("a blur mid-glide drops the lift so keyboard travel lands unlifted on the selected tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page, { clock: "playwright" });
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
  const invest = nav.getByRole("button", { name: "Invest" });
  const investBox = await requiredBox(invest);
  const point = { x: investBox.x + investBox.width / 2, y: investBox.y + investBox.height / 2 };
  await nav.evaluate((element) => {
    const interrupted = new Promise((resolve) => {
      new MutationObserver((_, observer) => {
        observer.disconnect();
        window.dispatchEvent(new Event("blur"));
        resolve({ pressed: element.hasAttribute("data-lens-pressed"), gliding: element.hasAttribute("data-lens-glide") });
      }).observe(element, { attributeFilter: ["data-lens-glide"] });
    });
    Object.assign(window, { interrupted });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
  await page.clock.runFor(50);
  expect(await page.evaluate(() => (window as unknown as { interrupted: Promise<unknown> }).interrupted))
    .toEqual({ pressed: false, gliding: false });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await invest.focus();
  await page.keyboard.press("Enter");
  await expect(invest).toHaveAttribute("aria-current", "page");
  await expect(nav).not.toHaveAttribute("data-lens-pressed");
  await expect(nav).not.toHaveAttribute("data-lens-glide");
  expect(await settledLensTab(page)).toBe("invest-nav");
});

function settledLensTab(page: Page) {
  return page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)')!;
    const lens = nav.querySelector<HTMLElement>('[data-navigation-lens="ready"]')!;
    await Promise.all(lens.getAnimations().map((animation) => animation.finished));
    const box = lens.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    const tab = Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button")).find((button) => {
      const rect = button.getBoundingClientRect();
      return centre > rect.left && centre < rect.right && box.width <= rect.width + 1;
    });
    return tab?.id ?? null;
  });
}
