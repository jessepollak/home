import { expect, test, type Locator, type Page } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";
import { FIXED_NOW } from "./fixtures/fixed-time";
import { waitForShellHydration } from "./fixtures/shell-hydration";

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
    const tabs = process.env.BRIDGE_CARDS_ENABLED === "1" ? 3 : 2;
    expect(geometry.nav.width).toBe(tabs === 2 ? 160 : Math.min(248, width - 102));
    expect(geometry.nav.height).toBe(52);
    expect(geometry.tabHeights).toEqual(Array.from({ length: tabs }, () => 44));
    expect(844 - geometry.nav.bottom).toBe(12);
    if (!geometry.search) throw new Error("Expected Search control");
    expect(geometry.nav.left).toBe(21);
    expect(width - geometry.search.right).toBe(21);
    expect(geometry.search.top).toBe(geometry.nav.top);
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.nav.top);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const cdp = await page.context().newCDPSession(page);
    for (const root of [14, 16, 32]) for (const dir of ["ltr", "rtl"]) {
      await test.step(`${tabs} tabs, ${root}px root, ${dir}`, async () => {
        await page.goto("/home");
        await waitForShellHydration(page);
        await page.evaluate(({ root, dir }) => {
          document.documentElement.style.fontSize = `${root}px`;
          document.documentElement.dir = dir;
        }, { root, dir });
        const nav = page.locator('nav[aria-label="Main navigation"]:not(#desktop-rail nav)');
        const buttons = nav.locator(":scope > button");
        await expect(buttons).toHaveCount(tabs);
        await expect(nav.locator('[data-navigation-lens="ready"]')).toBeVisible();
        const capsule = await requiredBox(nav);
        const opener = await requiredBox(page.getByRole("button", { name: "Search assets", exact: true }));
        const closedSize = Math.max(root * 3.25, 44 + root * .5);
        const inset = root * .25;
        expect(capsule.height).toBe(closedSize);
        expect(opener.height).toBe(closedSize);
        expect(opener.width).toBe(closedSize);
        expect(opener.y).toBe(capsule.y);
        const frameInset = Math.min(root * 1.3125, 21);
        const capsuleWidth = Math.min(root * (tabs === 2 ? 4.75 : 5) * tabs + 2 * inset, width - 2 * frameInset - closedSize - root * .5);
        expect(capsule.width).toBeCloseTo(capsuleWidth, 1);
        expect(capsule.x).toBeGreaterThanOrEqual(frameInset - .01);
        expect(capsule.x + capsule.width).toBeLessThanOrEqual(width - frameInset + .01);
        expect(opener.x).toBeGreaterThanOrEqual(frameInset - .01);
        expect(opener.x + opener.width).toBeLessThanOrEqual(width - frameInset + .01);
        expect(dir === "ltr" ? opener.x - capsule.x - capsule.width : capsule.x - opener.x - opener.width).toBeGreaterThanOrEqual(root * .5 - .01);
        for (let index = 0; index < tabs; index += 1) {
          const button = buttons.nth(index);
          const target = await requiredBox(button);
          expect(target.height).toBeGreaterThanOrEqual(44);
          expect(target.height).toBe(closedSize - 2 * inset);
          expect(Math.abs(target.width - (capsule.width - 2 * inset) / tabs)).toBeLessThan(1 / 32);
          expect(target.y - capsule.y).toBe(inset);
          expect(capsule.y + capsule.height - target.y - target.height).toBe(inset);
          const glyph = await requiredBox(button.locator(":scope > span > svg"));
          expect(glyph.height).toBe(root * 27 / 16);
          expect(glyph.width).toBe(glyph.height);
          expect(await button.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return [rect.top + .5, rect.top + rect.height / 2, Math.floor(rect.bottom) - 1].every((y) => node.contains(document.elementFromPoint(rect.x + rect.width / 2, y)));
          })).toBe(true);
        }
        for (const pill of [nav.locator("[data-navigation-pill]"), nav.locator('[data-navigation-lens="ready"]')]) {
          const selected = await requiredBox(nav.getByRole("button", { name: "Home", exact: true }));
          await expect.poll(async () => {
            const rect = await requiredBox(pill);
            return Math.max(Math.abs(rect.x - selected.x), Math.abs(rect.y - selected.y), Math.abs(rect.width - selected.width), Math.abs(rect.height - selected.height));
          }).toBeLessThan(.02);
        }
        const clearance = await page.locator("[data-app-main-authenticated]").evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));
        expect(clearance).toBe(closedSize + root * .75 + root * .5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (let index = tabs - 1; index >= 0; index -= 1) {
          const button = buttons.nth(index);
          const target = await requiredBox(button);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: target.x + target.width / 2, y: Math.floor(target.y + target.height) - 1, id: 1 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect(button).toHaveAttribute("aria-current", "page");
        }
      });
    }
    await cdp.detach();
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
      expect(clearance).toBe(52 + 12 + 8);
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
  expect(await nav.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(160);
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

const railMotionTargets = "#desktop-rail > div, #desktop-rail > div > div, [data-rail-follower]";

async function finishRailMotion(page: Page) {
  await page.evaluate((selector) => {
    const animations = document.getAnimations().filter((animation) => animation.effect instanceof KeyframeEffect &&
      Number.isFinite(animation.effect.getComputedTiming().endTime) &&
      animation.effect.target instanceof Element && animation.effect.target.matches(selector));
    for (const animation of animations) animation.finish();
  }, railMotionTargets);
}

async function finishSearchMotion(page: Page) {
  await page.evaluate(() => {
    const animations = document.getAnimations().filter((animation) => {
      if (!(animation.effect instanceof KeyframeEffect) || !Number.isFinite(animation.effect.getComputedTiming().endTime) ||
        !(animation.effect.target instanceof Element)) return false;
      const target = animation.effect.target;
      return target.matches('#asset-search-surface > div[aria-hidden="true"]') ||
        (target.closest("[data-asset-search-bar]") && animation instanceof CSSTransition &&
          ["transform", "opacity"].includes(animation.transitionProperty));
    });
    for (const animation of animations) animation.finish();
  });
}

async function openDesktopRail(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.addInitScript((selector) => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      if (this.matches(selector) && animation.effect && Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.pause();
      return animation;
    };
  }, railMotionTargets);
  await page.goto("/home");
  await waitForShellHydration(page);
  await expect(page.locator("#desktop-rail")).toHaveAttribute("data-rail-state", "expanded");
  await page.evaluate(() => document.fonts.ready);
}

async function seekRail(page: Page, time: number) {
  const targets = await page.evaluate(({ at, selector }) => {
    const running = document.getAnimations().filter((animation) => animation.effect instanceof KeyframeEffect &&
      Number.isFinite(animation.effect.getComputedTiming().endTime) &&
      animation.effect.target instanceof Element && animation.effect.target.matches(selector));
    for (const animation of running) animation.currentTime = at;
    const animated = running.map((animation) => animation.effect instanceof KeyframeEffect ? animation.effect.target : null);
    return { count: running.length, panel: animated.includes(document.querySelector("#desktop-rail > div")),
      main: animated.includes(document.querySelector("main")), header: animated.includes(document.querySelector("header[data-rail-follower]")) };
  }, { at: time, selector: railMotionTargets });
  expect(targets.count).toBeGreaterThan(0);
  expect({ panel: targets.panel, main: targets.main, header: targets.header }).toEqual({ panel: true, main: true, header: true });
}

test("a mid-collapse rail stays within the viewport without releasing the sticky header", async ({ page }) => {
  await openDesktopRail(page);
  await page.locator("main").evaluate((element) => { element.style.minHeight = "1600px"; });
  await page.getByRole("button", { name: "Sidebar" }).click();
  await seekRail(page, 90);
  const geometry = await page.evaluate(() => {
    const width = document.documentElement.scrollWidth;
    window.scrollTo(100, 0);
    return { width, viewport: innerWidth, scrollX };
  });
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scrollX).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => page.evaluate(() => ({ scrollY, headerTop: document.querySelector("header[data-rail-follower]")?.getBoundingClientRect().top })))
    .toEqual({ scrollY: 200, headerTop: 0 });
  await finishRailMotion(page);
  await expect(page.locator("[data-rail-column]")).toHaveCSS("overflow-x", "visible");
});

test("Search opened mid-collapse stays below the reachable shared header and keeps its field aligned", async ({ page }) => {
  await openDesktopRail(page);
  await page.getByRole("button", { name: "Sidebar" }).click();
  await seekRail(page, 90);
  await page.getByRole("button", { name: "Search assets", exact: true }).click();
  const search = page.getByRole("region", { name: "Search", exact: true });
  const header = page.getByRole("banner");
  const back = header.getByRole("button", { name: "Back", exact: true });
  await expect(search).toBeVisible();
  await expect(header).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(header.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search assets" })).toBeFocused();
  const assertShellGeometry = async () => {
    const headerBox = await requiredBox(header);
    const searchBox = await requiredBox(search);
    const barBox = await requiredBox(page.locator("[data-asset-search-bar]"));
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Expected a configured viewport for Search geometry");
    expect(headerBox.y).toBe(0);
    expect(searchBox.y).toBe(headerBox.y + headerBox.height);
    expect(searchBox.height).toBeGreaterThan(0);
    expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(viewport.height);
    expect(barBox.y).toBeGreaterThanOrEqual(searchBox.y);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(searchBox.y + searchBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await back.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await back.focus();
    await expect(back).toBeFocused();
  };
  await finishSearchMotion(page);
  await assertShellGeometry();
  await finishRailMotion(page);
  await assertShellGeometry();
  const settledSearch = await requiredBox(search);
  const settledBar = await requiredBox(page.locator("[data-asset-search-bar]"));
  expect(settledBar.x).toBeGreaterThanOrEqual(settledSearch.x);
  expect(settledBar.x + settledBar.width).toBeLessThanOrEqual(settledSearch.x + settledSearch.width);
  expect(settledBar.x + settledBar.width / 2).toBe(settledSearch.x + settledSearch.width / 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await requiredBox(page.locator("[data-asset-search-bar]"))).x).toBe(23);
  await finishSearchMotion(page);
  await assertShellGeometry();
  const field = await requiredBox(page.getByRole("search"));
  const close = await requiredBox(page.getByRole("button", { name: "Close search" }));
  expect(field.height).toBe(48);
  expect(close.height).toBe(48);
  expect(close.x - field.x - field.width).toBe(12);
  expect(390 - close.x - close.width).toBe(23);
  expect(844 - field.y - field.height).toBe(14);
  expect(await page.locator("[data-asset-search-bar]").evaluate((node) => getComputedStyle(node).position)).toBe("fixed");
  await back.click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("a collapsed state from another tab mid-collapse retargets without a stale transform", async ({ page }) => {
  await openDesktopRail(page);
  const rail = page.locator("#desktop-rail");
  const seam = () => rail.locator(":scope > div").evaluate((panel) => panel.getBoundingClientRect().right);
  const homeHit = () => page.locator("#home-rail-nav svg").evaluate((icon) => {
    const box = icon.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("#home-rail-nav") != null;
  });
  await page.getByRole("button", { name: "Sidebar" }).click();
  await seekRail(page, 60);
  const before = await seam();
  await page.evaluate(() => {
    localStorage.setItem("home:sidebar:collapsed", "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "home:sidebar:collapsed", newValue: "false" }));
  });
  await expect(rail).toHaveAttribute("data-rail-state", "expanded");
  await seekRail(page, 0);
  expect(Math.abs(await seam() - before)).toBeLessThan(1);
  expect(await homeHit()).toBe(true);
  await finishRailMotion(page);
  expect(await seam()).toBe(240);
  expect(await homeHit()).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll("#desktop-rail div, main"), document.querySelector("main")?.parentElement]
    .filter((element) => element instanceof HTMLElement && (getComputedStyle(element).transform !== "none" || element.style.overflowX !== "")).length)).toBe(0);
});
