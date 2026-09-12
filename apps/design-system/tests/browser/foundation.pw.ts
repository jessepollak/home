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
  const clipped = await page.locator(".home-ui-text, .home-ui-money-ticker, .home-ui-button, .home-ui-field, .home-ui-control, .home-ui-list-row, .home-ui-list-row__content, .home-ui-badge, .home-ui-divider, .catalog-section, .catalog-controls, .catalog-control-grid, .catalog-control-grid label, .home-ui-empty-state, .home-ui-status-message, .home-ui-toast").evaluateAll((elements) =>
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
      await expect(page.locator("[data-ticker-specimen]")).toHaveAttribute("aria-label", "$1,234.56");
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

for (const width of [320, 390]) {
  test(`Field, Input, and Select remain associated and usable at ${width}px / 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Text size" }).selectOption("200");

    const email = page.getByRole("textbox", { name: /Email address/ });
    const amount = page.getByRole("textbox", { name: "Deposit amount" });
    const address = page.getByRole("textbox", { name: "Wallet address" });
    const country = page.getByRole("combobox", { name: "Country" });
    await expect(email).toHaveAttribute("required", "");
    await expect(email).toHaveAttribute("aria-describedby", "catalog-email-hint");
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(address).toHaveAttribute("aria-describedby", "catalog-address-error");
    await expect(page.locator("#catalog-address-error")).toHaveText("Enter a valid Base address");
    await expect(country).toHaveAttribute("aria-describedby", "catalog-country-hint");
    await expect(amount.locator("xpath=..")).toContainText("$USD");

    for (const control of [email, amount, address, country]) {
      const box = await control.locator("xpath=..").boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoOverflow(page);
  });
}

test("Field controls follow native keyboard order and expose the shared focus halo", async ({ page }) => {
  await page.goto("/");
  const email = page.getByRole("textbox", { name: /Email address/ });
  const amount = page.getByRole("textbox", { name: "Deposit amount" });
  const address = page.getByRole("textbox", { name: "Wallet address" });
  const paste = page.getByRole("button", { name: "Paste", exact: true });
  const country = page.getByRole("combobox", { name: "Country" });

  await email.focus();
  await expect(email).toBeFocused();
  await expect(email.locator("xpath=..")).toHaveCSS("box-shadow", "rgba(0, 82, 255, 0.18) 0px 0px 0px 3px");
  await page.keyboard.press("Tab");
  await expect(amount).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(address).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(paste).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(country).toBeFocused();
  await country.press("ArrowDown");
  await expect(country).toBeFocused();
});

for (const width of [320, 390, 1280]) {
  test(`ListRow, Badge, and Divider stay readable at ${width}px / 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Text size" }).selectOption("200");

    const rows = page.locator(".home-ui-list-row");
    await expect(rows).toHaveCount(3);
    await expect(page.getByText("Received from a wallet with a long and detailed display name", { exact: true })).toBeVisible();
    await expect(page.getByText("+$1,234,567.89", { exact: true })).toBeVisible();
    await expect(page.locator(".home-ui-badge")).toHaveCount(5);
    await expect(page.getByRole("separator", { name: "Before and after" })).toHaveAttribute("aria-orientation", "vertical");
    for (const control of await rows.locator(".home-ui-list-row__control").all()) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoOverflow(page);
  });
}

test("interactive ListRows follow keyboard order and native activation", async ({ page }) => {
  await page.goto("/");
  const pressable = page.getByRole("button", { name: "Open received transaction" });
  const linked = page.getByRole("link", { name: "View Ethereum details" });
  const count = page.locator("[data-row-activations]");
  await pressable.focus();
  await expect(pressable).toBeFocused();
  await expect(pressable).toHaveCSS("outline-style", "solid");
  await pressable.press("Enter");
  await pressable.press("Space");
  await expect(count).toHaveText("Row activations: 2");
  await page.keyboard.press("Tab");
  await expect(linked).toBeFocused();
  await expect(linked).toHaveAttribute("href", "#list-row-title");
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

test("shared radii, press motion, layout spacing, and surface colors render from the package", async ({ page }) => {
  await page.goto("/");
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  const iconButton = page.getByRole("button", { name: "Add example" });
  await expect(primary).toHaveCSS("border-radius", "6px");
  await expect(iconButton).toHaveCSS("border-radius", "6px");

  for (const button of [primary, iconButton]) {
    await button.hover();
    await page.mouse.down();
    await expect(button).toHaveCSS("transform", "matrix(0.97, 0, 0, 0.97, 0, 0)");
    await page.mouse.up();
    await expect(button).toHaveCSS("transform", "none");
  }

  await expect(page.locator("[data-layout='stack']")).toHaveCSS("gap", "12px");
  await expect(page.locator("[data-layout='inline']")).toHaveCSS("gap", "8px");
  await expect(page.locator("[data-layout='inset']")).toHaveCSS("padding", "12px");
  await expect(page.locator("[data-layout='bleed']")).toHaveCSS("margin", "-12px");
  await expect(page.locator("[data-layout='custom']")).toHaveCSS("gap", "18px");

  const primarySurface = page.locator("[data-surface='primary']");
  const accentSurface = page.locator("[data-surface='accent']");
  const tintedSurface = page.locator("[data-surface='tinted-accent']");
  await expect(primarySurface).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(primarySurface.getByText("Default text")).toHaveCSS("color", "rgb(10, 11, 13)");
  await expect(accentSurface).toHaveCSS("background-color", "rgb(0, 82, 255)");
  await expect(accentSurface.getByText("Default text")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(accentSurface.getByText("Muted text")).toHaveCSS("color", "rgb(217, 229, 255)");
  await expect(accentSurface.locator(".catalog-separator")).toHaveCSS("background-color", "rgb(112, 156, 255)");
  await expect(tintedSurface).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(tintedSurface.getByText("Default text")).toHaveCSS("color", "rgb(0, 58, 184)");

  await page.getByRole("combobox", { name: "Text size" }).selectOption("200");
  await expect(page.locator("[data-layout='stack']")).toHaveCSS("gap", "24px");
  await expectNoOverflow(page);
});

test("semantic token catalog renders every new token without overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  const tokens = page.locator("[data-token]");
  await expect(tokens).toHaveCount(19);
  await expect(tokens.locator(".catalog-token-swatch")).toHaveCount(19);
  const unresolved = await tokens.evaluateAll((elements) => elements.flatMap((element) => {
    const swatch = element.querySelector<HTMLElement>(".catalog-token-swatch");
    if (!swatch) return [element.getAttribute("data-token")];
    const style = getComputedStyle(swatch);
    const kind = element.getAttribute("data-token-kind");
    if (kind === "color" && style.backgroundColor === "rgba(0, 0, 0, 0)") return [element.getAttribute("data-token")];
    if (kind === "shadow" && style.boxShadow === "none") return [element.getAttribute("data-token")];
    if (kind === "layer" && style.zIndex === "auto") return [element.getAttribute("data-token")];
    if (kind === "easing" && !style.transitionTimingFunction) return [element.getAttribute("data-token")];
    return [];
  }));
  expect(unresolved).toEqual([]);
  await expectNoOverflow(page);
});

for (const width of [320, 390, 1280]) {
  test(`Sheet stays anchored and readable at ${width}px with 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Text size" }).selectOption("200");
    await page.getByRole("button", { name: "Open sheet with footer" }).click();
    const dialog = page.getByRole("dialog", { name: "Sheet specimen" });
    const panel = dialog.locator("[data-home-ui-sheet-panel]");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm sheet action" })).toBeVisible();
    await expect(panel).toHaveAttribute("data-position-owner", "idle");
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(Math.abs(box!.y + box!.height - 900)).toBeLessThanOrEqual(2);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Confirm sheet action" }).click();
    await expect(dialog).toBeHidden();
  });
}

test("Sheet traps focus, dismisses with Escape, and restores its trigger", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open sheet", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Sheet specimen" });
  const action = page.getByRole("button", { name: "Sheet action" });
  await expect(action).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close sheet" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Sheet blocks Escape and backdrop dismissal when non-dismissible", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open non-dismissible sheet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Required decision" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Finish required action" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Sheet reduced-motion mode settles immediately and forced colors preserve its boundary", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open reduced-motion sheet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Sheet specimen" });
  const panel = dialog.locator("[data-home-ui-sheet-panel]");
  await expect(panel).toHaveAttribute("data-position-owner", "idle");
  await expect(panel).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("feedback primitives expose live semantics, dismiss on schedule, and fit at 320px", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const feedback = page.getByRole("region", { name: "Feedback" });
  await expect(feedback.locator('[data-feedback="skeleton"] [data-rows="3"] > *')).toHaveCount(3);
  await expect(feedback.getByText("No activity yet", { exact: true })).toBeVisible();
  await expect(feedback.getByRole("alert")).toContainText("Activity unavailable");
  const viewport = page.getByRole("region", { name: "Notifications" });
  await expect(viewport).toHaveAttribute("aria-live", "polite");

  await feedback.getByRole("button", { name: "Show toast" }).click();
  const toast = page.locator(".home-ui-toast", { hasText: "Action confirmed" });
  await expect(toast).toBeVisible();
  await page.clock.fastForward(5_000);
  await expect(toast).toBeHidden();
  await expectNoOverflow(page);
});

test("reduced motion makes skeletons static and toast entry immediate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const skeleton = page.locator('[data-feedback="skeleton"] .home-ui-skeleton').first();
  expect(await skeleton.evaluate((element) => getComputedStyle(element, "::after").animationName)).toBe("none");
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Action confirmed", { exact: true }).locator("xpath=..")).toHaveCSS("animation-name", "none");
});

test("native keyboard activation, focus, pressed presentation, and disabled/loading safety", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  const status = page.locator("output");
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

test("reduced motion uses opacity-only press feedback and removes spinner animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Motion: reduced", { exact: true })).toBeVisible();
  const ticker = page.locator("[data-ticker-specimen]");
  await page.getByRole("button", { name: "Update balance ticker" }).click();
  await expect(ticker).toHaveAttribute("aria-label", "$9,876.54");
  expect(await ticker.locator("number-flow-react").evaluateAll((digits) =>
    digits.every((digit) => (digit as HTMLElement & { animated?: boolean }).animated === false),
  )).toBe(true);
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  await expect(primary).toHaveCSS("transition-duration", "0s");
  await expect(primary).toHaveCSS("opacity", "1");
  await primary.hover();
  await page.mouse.down();
  await expect(primary).toHaveCSS("transform", "none");
  await expect(primary).toHaveCSS("opacity", "0.72");
  await page.mouse.up();
  await expect(primary).toHaveCSS("opacity", "1");
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
