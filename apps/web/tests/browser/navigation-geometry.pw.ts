import { expect, test } from "@playwright/test";
import { installApiFixtures, json, seedSignedInSession } from "./fixtures/api";
import { sessionBody } from "./fixtures/bodies";

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
      main.scrollTop = main.scrollHeight;
      const lastContent = main.lastElementChild as HTMLElement;
      return {
        nav: nav.getBoundingClientRect().toJSON(),
        contentBottom: lastContent.getBoundingClientRect().bottom,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        position: getComputedStyle(nav).position,
        tabHeights: Array.from(nav.querySelectorAll("button"), (button) => button.getBoundingClientRect().height),
      };
    });
    expect(geometry.position).toBe("fixed");
    expect(geometry.nav.width).toBe(192);
    expect(geometry.nav.height).toBe(62);
    expect(geometry.tabHeights).toEqual([54, 54]);
    expect(844 - geometry.nav.bottom).toBe(12);
    expect(Math.abs(geometry.nav.left + geometry.nav.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.nav.top);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  });

  test(`mobile navigation stays anchored with main as the only scroller at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect(page.getByText("Loading recent activity…")).toHaveCount(0);
    const boundary = async () => page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]:not(#desktop-rail nav)')!;
      const main = document.querySelector<HTMLElement>("[data-app-main-authenticated]")!;
      main.scrollTop = main.scrollHeight;
      window.scrollTo(0, document.documentElement.scrollHeight);
      return {
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        pageScroll: window.scrollY,
        mainScrolls: main.scrollHeight > main.clientHeight,
        navGap: window.innerHeight - nav.getBoundingClientRect().bottom,
      };
    });
    for (const height of [844, 700, 844]) {
      await page.setViewportSize({ width, height });
      const result = await boundary();
      expect(result.documentHeight).toBe(result.viewportHeight);
      expect(result.pageScroll).toBe(0);
      expect(result.mainScrolls).toBe(true);
      expect(result.navGap).toBe(12);
    }
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }]) {
  test(`Home money and Activity scroll geometry at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.route("**/api/activity*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== "/api/activity") return route.fallback();
      const to = url.searchParams.get("to") ?? new Date().toISOString();
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
    const main = page.locator("main[data-app-main-authenticated]");
    await expect(page.getByRole("region", { name: "Activity" })).not.toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("region", { name: "Activity" }).getByRole("button", { name: /Received/ }).first()).toBeVisible();
    await expect.poll(() => main.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(300);
    const beforeMoney = await money.boundingBox();
    const beforeActivity = await activity.boundingBox();
    expect(beforeMoney).not.toBeNull();
    expect(beforeActivity).not.toBeNull();
    expect(beforeActivity!.x).toBeGreaterThan(beforeMoney!.x + beforeMoney!.width);
    if (viewport.height >= 640) {
      expect(beforeMoney!.width / beforeActivity!.width).toBeGreaterThan(1.4);
      expect(beforeMoney!.width / beforeActivity!.width).toBeLessThan(1.6);
      expect(beforeMoney!.height + 48).toBeLessThanOrEqual(await main.evaluate((node) => node.clientHeight));
    }
    await main.evaluate((node) => { node.scrollTop = 200; });
    await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(190);
    if (viewport.height >= 640) {
      await expect.poll(async () => Math.abs((await money.boundingBox())!.y - beforeMoney!.y)).toBeLessThanOrEqual(2);
    } else {
      await expect.poll(async () => beforeMoney!.y - (await money.boundingBox())!.y).toBeGreaterThan(150);
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
  expect(await nav.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
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
  const homeBox = (await home.boundingBox())!;
  const investBox = (await invest.boundingBox())!;
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
    const main = page.locator("main[data-app-main-authenticated]");
    await main.evaluate((node) => { node.scrollTop = 120; });
    const scrolled = await main.evaluate((node) => node.scrollTop);
    const windowScroll = await page.evaluate(() => window.scrollY);
    const homeBox = (await nav.getByRole("button", { name: "Home" }).boundingBox())!;
    const investBox = (await nav.getByRole("button", { name: "Invest" }).boundingBox())!;
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
    expect(await main.evaluate((node) => node.scrollTop)).toBe(scrolled);
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
    const homeBox = (await nav.getByRole("button", { name: "Home" }).boundingBox())!;
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
  const investBox = (await nav.getByRole("button", { name: "Invest" }).boundingBox())!;
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
  await installApiFixtures(page);
  await page.clock.install();
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const lens = nav.locator('[data-navigation-lens="ready"]');
  await expect(lens).toBeVisible();
  const invest = nav.getByRole("button", { name: "Invest" });
  const investBox = (await invest.boundingBox())!;
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
  await expect.poll(() => lens.evaluate((element) => element.style.transform)).toBe("translateX(100%)");
  await lens.evaluate((element) => {
    const seen: string[] = [];
    new MutationObserver(() => seen.push(element.style.transform)).observe(element, { attributeFilter: ["style"] });
    Object.assign(window, { lensPlaces: seen });
  });
  await touch("touchEnd");
  await expect(nav).not.toHaveAttribute("data-lens-pressed");
  await expect.poll(() => page.evaluate(() => "commitNavigation" in window)).toBe(true);
  await page.clock.runFor(1_500);
  await expect(invest).not.toHaveAttribute("aria-current");
  await page.evaluate(() => (window as unknown as { commitNavigation: () => void }).commitNavigation());
  await expect(invest).toHaveAttribute("aria-current", "page");
  await expect.poll(() => lens.evaluate((element) => element.style.transform)).toBe("translateX(100%)");
  expect(await page.evaluate(() => (window as unknown as { lensPlaces: string[] }).lensPlaces)).not.toContain("translateX(0%)");
});
