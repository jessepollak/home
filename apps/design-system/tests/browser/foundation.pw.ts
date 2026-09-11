import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// CDP distinguishes the font that painted glyphs from a merely declared family.
async function platformFonts(page: Page, selector: string) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
  } finally {
    await cdp.detach();
  }
}

async function digitWidths(page: Page, role: string) {
  return page.locator(`[data-number-probe="${role}"] .home-ui-text`).evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    }),
  );
}

async function expectWholeAsciiWords(locator: Locator) {
  const fragmented = await locator.evaluate((element) => {
    const fragments: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.parentElement || node.parentElement.getClientRects().length === 0) continue;
      for (const match of node.data.matchAll(/[A-Za-z]{4,}/g)) {
        const range = document.createRange();
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        if (Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).length !== 1) {
          fragments.push(match[0]);
        }
      }
    }
    return fragments;
  });
  expect(fragmented).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const clipped = await page.locator(".home-ui-text, .home-ui-button, .catalog-section, .catalog-controls, .catalog-control-grid, .catalog-control-grid label").evaluateAll((elements) =>
    elements.filter((element) => {
      // Tight display line boxes can have visible font ink outside their height;
      // that is not clipping. Still reject horizontal overflow and any vertical
      // overflow a container actually clips (including enclosing sections).
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1
        || (style.overflowY !== "visible" && element.scrollHeight > element.clientHeight + 1);
    }).map((element) => element.textContent),
  );
  expect(clipped).toEqual([]);
}

for (const width of [320, 390, 1280]) {
  for (const scale of ["100", "200"]) {
    test(`${width}px / ${scale}% text: full labels, values, targets, and no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.getByRole("combobox", { name: "Text size" }).selectOption(scale);
      await expect(page.locator("html")).toHaveCSS("font-size", scale === "200" ? "32px" : "16px");
      await expect(page.getByText("₹12,34,56,789.00", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^A long button label/ })).toBeVisible();
      await expectNoOverflow(page);
      for (const button of await page.locator(".home-ui-button").all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      for (const icon of await page.locator(".home-ui-icon-button svg").all()) {
        const box = await icon.boundingBox();
        expect([20, 24]).toContain(box!.width);
        expect([20, 24]).toContain(box!.height);
        await expect(icon).toHaveAttribute("aria-hidden", "true");
      }
      await page.getByRole("checkbox", { name: "System font fallback" }).check();
      await expectNoOverflow(page);
    });
  }
}

test("320px / 200% text keeps all catalog words whole in loaded, fallback, and failed-font states", async ({ page }) => {
  const expectReadableCatalog = async (catalog: Page) => {
    await expect(catalog.getByRole("heading", { name: "Home UI foundation", exact: true })).toBeVisible();
    await expectWholeAsciiWords(catalog.locator("main"));
  };
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Text size" }).selectOption("200");
  await expectReadableCatalog(page);
  await page.getByRole("checkbox", { name: "System font fallback" }).check();
  await expectReadableCatalog(page);

  const browser = page.context().browser();
  expect(browser).not.toBeNull();
  const failedFontContext = await browser!.newContext();
  const failedFontPage = await failedFontContext.newPage();
  try {
    await failedFontPage.setViewportSize({ width: 320, height: 900 });
    await failedFontPage.route(/\.(woff2|ttf)$/, (route) => route.abort());
    await failedFontPage.goto("/");
    await failedFontPage.getByRole("combobox", { name: "Text size" }).selectOption("200");
    await failedFontPage.evaluate(() => document.fonts.ready);
    expect(await failedFontPage.evaluate(() => Array.from(document.fonts).filter((font) => font.status === "error").length)).toBe(3);
    await expectReadableCatalog(failedFontPage);
  } finally {
    await failedFontContext.close();
  }
});

test("narrow normal-size icon buttons retain shared 44px geometry", async ({ page }) => {
  for (const [width, rootSize] of [[320, "16px"], [390, "16px"], [320, "12px"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator("html").evaluate((element, size) => { element.style.fontSize = size; }, rootSize);
    await expect(page.locator("html")).toHaveCSS("font-size", rootSize);
    for (const iconButton of await page.locator(".home-ui-icon-button").all()) {
      const box = await iconButton.boundingBox();
      expect(box!.width).toBe(44);
      expect(box!.height).toBe(44);
    }
  }
});

test("native keyboard activation, focus, pressed presentation, and disabled/loading safety", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  const status = page.getByRole("status");
  const focusControl = page.getByRole("button", { name: "Focus primary" });
  await focusControl.focus();
  await focusControl.press("Enter");
  await expect(primary).toBeFocused();
  await expect(primary).toHaveCSS("outline-style", "solid");
  await expect(primary).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Secondary", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(primary).toBeFocused();
  await expect(primary).toHaveCSS("outline-style", "solid");
  await primary.press("Enter");
  await primary.press("Space");
  await expect(status).toHaveText("Activations: 2");
  await expect(primary).toHaveAttribute("type", "button");
  // A native default button must not submit even when moved into a form.
  const submissions = await primary.evaluate((button) => {
    const form = document.createElement("form");
    let count = 0;
    form.addEventListener("submit", (event) => { event.preventDefault(); count += 1; });
    button.before(form);
    form.append(button);
    (button as HTMLButtonElement).click();
    form.before(button);
    form.remove();
    return count;
  });
  expect(submissions).toBe(0);
  await expect(status).toHaveText("Activations: 3");
  const normalColor = await primary.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByRole("checkbox", { name: "Pressed", exact: true }).check();
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await expect(primary).not.toHaveCSS("background-color", normalColor);
  // Wait for the 100ms color transition to settle before any state measurement.
  await expect(primary).toHaveCSS("background-color", "rgb(0, 58, 184)");
  await page.getByRole("checkbox", { name: "Disabled", exact: true }).check();
  await expect(primary).toBeDisabled();
  await primary.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(status).toHaveText("Activations: 3");
  await page.getByRole("checkbox", { name: "Disabled", exact: true }).uncheck();
  const normalSize = await primary.boundingBox();
  await page.getByRole("checkbox", { name: "Loading", exact: true }).check();
  await expect(primary).toBeDisabled();
  await expect(primary).toHaveAttribute("aria-busy", "true");
  const loadingSize = await primary.boundingBox();
  expect(loadingSize!.width).toBe(normalSize!.width);
  expect(loadingSize!.height).toBe(normalSize!.height);
  await expect(page.getByRole("button", { name: "Add example" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("package utility and semantic adapter are emitted in the production catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Primary", exact: true })).toHaveCSS("isolation", "isolate");
  await expect(page.getByRole("region", { name: "Typography", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("local DM Sans normal/italic and DM Mono load; system fallback replaces both families", async ({ page }) => {
  const fontUrls: string[] = [];
  page.on("response", (response) => {
    if (/\.(woff2|ttf)$/.test(response.url()) && response.ok()) fontUrls.push(response.url());
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const specimen = page.getByText("₹12,34,56,789.00", { exact: true });
  const family = await specimen.evaluate((element) => getComputedStyle(element).fontFamily);
  const loaded = await page.evaluate(() => Array.from(document.fonts).filter((face) => face.status === "loaded").map((face) => face.style));
  expect(loaded).toContain("normal");
  expect(loaded).toContain("italic");
  expect(new Set(fontUrls).size).toBe(3);
  expect(fontUrls.filter((url) => url.endsWith(".ttf"))).toHaveLength(1);
  expect(fontUrls.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  // Check the actual font used for a representative covered currency symbol,
  // rather than treating FontFaceSet.check as proof of glyph coverage.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[aria-labelledby='amounts-title'] [data-text-style='amount']" });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(fonts.some((font) => font.isCustomFont && font.familyName.includes("DM Mono") && font.glyphCount > 0)).toBe(true);
  await cdp.detach();
  const prose = page.locator('[data-number-probe="body"] .home-ui-text').first();
  const proseFamily = await prose.evaluate((element) => getComputedStyle(element).fontFamily);
  await page.getByRole("checkbox", { name: "System font fallback" }).check();
  await expect(prose).not.toHaveCSS("font-family", proseFamily);
  await expect(specimen).not.toHaveCSS("font-family", family);
  await expect(specimen).toBeVisible();
});

test("failed font requests retain legible content at narrow/enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route(/\.(woff2|ttf)$/, (route) => route.abort());
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("combobox", { name: "Text size" }).selectOption("200");
  await expect(page.getByRole("button", { name: "Primary", exact: true })).toBeVisible();
  await expect(page.getByText("₹12,34,56,789.00", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Array.from(document.fonts).filter((font) => font.status === "error").length)).toBe(3);
  for (const role of ["amount", "row-value"]) {
    const fonts = await platformFonts(page, `[data-number-probe="${role}"] .home-ui-text`);
    expect(fonts.every((font) => !font.isCustomFont)).toBe(true);
    expect(fonts.some((font) => font.glyphCount > 0)).toBe(true);
  }
  await expectNoOverflow(page);
});

test("loaded amount and row-value digits have equal widths while DM Sans prose remains proportional", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const measurements: Record<string, number[]> = {};
  for (const role of ["amount", "row-value", "body"]) {
    const selector = `[data-number-probe="${role}"] .home-ui-text`;
    await expect(page.locator(selector)).toHaveText(["111111", "888888", "000000"]);
    const fonts = await platformFonts(page, selector);
    const family = role === "body" ? "DM Sans" : "DM Mono";
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => font.isCustomFont && font.familyName.includes(family))).toBe(true);
    const widths = await digitWidths(page, role);
    measurements[role] = widths;
    expect(widths.every((width) => width > 0)).toBe(true);
    if (role === "body") {
      expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(10);
    } else {
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.02);
    }
  }
  console.log("Loaded digit widths (111111, 888888, 000000):", JSON.stringify(measurements));
});

test("numeric system fallback keeps ASCII digits aligned without borrowing proportional DM Sans", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("checkbox", { name: "System font fallback" }).check();
  for (const role of ["amount", "row-value"]) {
    const fonts = await platformFonts(page, `[data-number-probe="${role}"] .home-ui-text`);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => !font.isCustomFont)).toBe(true);
    const widths = await digitWidths(page, role);
    expect(widths.every((width) => width > 0)).toBe(true);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(0.02);
  }
});

test("uncovered numeric currencies and scripts use platform glyph fallback, not DM Mono", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  for (const coverage of ["currencies", "arabic", "japanese"]) {
    const selector = `[data-font-coverage="${coverage}"]`;
    await expect(page.locator(selector)).toBeVisible();
    const fonts = await platformFonts(page, selector);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => !font.isCustomFont)).toBe(true);
    expect(fonts.some((font) => font.glyphCount > 0)).toBe(true);
    console.log(`${coverage} platform fallback:`, JSON.stringify(fonts));
  }
});

test("reduced motion removes spinner animation and press movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Motion: reduced", { exact: true })).toBeVisible();
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  await expect(primary).toHaveCSS("transition-duration", "0s");
  await primary.hover();
  await page.mouse.down();
  await expect(primary).toHaveCSS("transform", "none");
  await page.mouse.up();
  await page.getByRole("checkbox", { name: "Loading", exact: true }).check();
  await expect(primary.locator(".home-ui-button__spinner")).toHaveCSS("animation-name", "none");
});

test("catalog has no automated accessibility violations in normal/pressed/loading states", async ({ page }) => {
  await page.goto("/");
  for (const state of ["normal", "Pressed", "Loading"]) {
    if (state !== "normal") await page.getByRole("checkbox", { name: state, exact: true }).check();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations, `${state}: ${JSON.stringify(results.violations)}`).toEqual([]);
  }
});
