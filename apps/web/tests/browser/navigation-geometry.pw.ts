import { expect, test } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "./fixtures/api";

for (const width of [390, 320]) {
  test(`mobile navigation clears the final Home content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedSignedInSession(page);
    await installApiFixtures(page);
    await page.goto("/home");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
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
    expect(geometry.nav.height).toBe(60);
    expect(geometry.tabHeights).toEqual([52, 52]);
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
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main navigation"]')!;
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

test("desktop navigation remains in the top strip", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 844 });
  await seedSignedInSession(page);
  await installApiFixtures(page);
  await page.goto("/home");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((element) => getComputedStyle(element).position)).not.toBe("fixed");
});
