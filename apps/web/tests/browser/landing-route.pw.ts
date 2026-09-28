import { expect, test } from "@playwright/test";

test("signed-out landing Home mark has a full header hit target without moving its artwork", async ({ page }) => {
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const mark = page.getByRole("banner").getByRole("button", { name: "Home" });
    await expect(mark).toBeVisible();
    await expect(mark.locator("[data-square]")).toHaveCount(width >= 768 ? 4 : 0);
    const geometry = await mark.evaluate((control) => {
      const root = control.closest("[data-home-mark]")!;
      const rootBox = root.getBoundingClientRect();
      const target = control.getBoundingClientRect();
      const square = control.querySelector<HTMLElement>(
        window.innerWidth >= 768 ? "[data-square]" : '[aria-hidden="true"]',
      )!.getBoundingClientRect();
      return {
        root: { x: rootBox.x, y: rootBox.y, width: rootBox.width, height: rootBox.height },
        target: { x: target.x, y: target.y, width: target.width, height: target.height },
        square: { x: square.x, y: square.y, width: square.width, height: square.height },
        upperCornerHits: document.elementFromPoint(target.x + 3, target.y + 3)?.closest("button") === control,
      };
    });
    expect(geometry.target.width).toBeGreaterThanOrEqual(44);
    expect(geometry.target.height).toBeGreaterThanOrEqual(44);
    expect(geometry.upperCornerHits).toBe(true);
    if (width >= 768) {
      expect(geometry.root.height).toBe(28);
      expect(geometry.root.width).toBeGreaterThan(123);
      expect(geometry.target.y).toBe(geometry.root.y - 8);
      expect(geometry.square).toEqual({ x: geometry.root.x, y: geometry.root.y, width: 28, height: 28 });
      await mark.hover();
      expect((await mark.boundingBox())!.width).toBe(82);
    } else {
      expect(geometry.root.width).toBe(44);
      expect(geometry.root.height).toBe(44);
      expect(geometry.square).toEqual({ x: geometry.root.x + 10, y: geometry.root.y + 10, width: 24, height: 24 });
      await mark.hover();
      expect((await mark.boundingBox())!.width).toBe(44);
    }
    await page.keyboard.press("Tab");
    await expect(mark).toBeFocused();
    await expect(mark).toHaveCSS("outline-style", "solid");
  }
});
