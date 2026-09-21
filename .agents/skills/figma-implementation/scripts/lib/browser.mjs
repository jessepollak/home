// Playwright plumbing shared by measure.mjs and capture.mjs.
//
// Storybook is the Home proposal surface: stories render the production
// component with fixtures, so the canvas URL is the diff target instead of an
// app route and no `/dev` harness route is ever created (see SKILL.md).
//
// Playwright is not a declared package at the workspace root: apps/web owns
// `@playwright/test`, so this module resolves it through that package's
// resolution root instead of importing a bare `playwright` specifier.

import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveRepoRoot } from "./repo.mjs";

export const STORYBOOK_DEFAULT_BASE = "http://127.0.0.1:6006";

/** Frozen wall clock so `timeAgo`-style UI cannot drift between runs. */
export const FIXED_TIME = "2026-09-10T12:00:00.000Z";

/**
 * Daily navigation, animation, caret and scrollbar drift is the single largest
 * source of phantom pixel differences. Stories are captured with all of it off.
 */
export const STABILIZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
}
::-webkit-scrollbar { display: none !important; }
html { scrollbar-width: none !important; }
`;

/** @param {string} [root] */
export function loadPlaywright(root = resolveRepoRoot()) {
  const requireFromWeb = createRequire(join(root, "apps", "web", "package.json"));
  let playwright;
  try {
    playwright = requireFromWeb("@playwright/test");
  } catch (error) {
    throw new Error(
      `Could not resolve @playwright/test from apps/web/package.json (${error.message}). ` +
        "Run `bun install --frozen-lockfile` in the worktree first; this skill adds no dependency of its own.",
    );
  }
  if (!playwright?.chromium) {
    throw new Error("@playwright/test did not expose `chromium`; check the installed version.");
  }
  return playwright;
}

/**
 * @param {{
 *   url: string,
 *   viewport: { width: number, height: number },
 *   dpr?: number,
 *   colorScheme?: "light" | "dark",
 *   localStorage?: string[],
 *   dark?: boolean,
 *   waitForSelector?: string,
 *   waitText?: string,
 *   fonts?: string[],
 *   fontCheck?: boolean,
 *   hover?: string[],
 *   settleMs?: number,
 *   clock?: string,
 * }} options
 */
export async function openStory(options) {
  const {
    url,
    viewport,
    dpr = 1,
    colorScheme = "light",
    localStorage: localStorageEntries = [],
    dark = false,
    waitForSelector,
    waitText,
    fonts = [],
    fontCheck = false,
    hover = [],
    settleMs = 1200,
    clock = FIXED_TIME,
  } = options;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      colorScheme,
    });
    const page = await context.newPage();

    // Freeze the clock before navigation so any relative timestamp is stable.
    if (clock) {
      try {
        await page.clock.install({ time: new Date(clock) });
      } catch {
        // Older Playwright builds lack the clock API; fixtures must pin dates instead.
      }
    }
    if (localStorageEntries.length) {
      const pairs = localStorageEntries.map((entry) => {
        const index = entry.indexOf("=");
        if (index === -1) throw new Error(`--ls expects key=value, got: ${entry}`);
        return [entry.slice(0, index), entry.slice(index + 1)];
      });
      await page.addInitScript((entries) => {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      }, pairs);
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(waitForSelector ?? "#storybook-root > *", { timeout: 30000 });
    if (waitText) {
      await page.getByText(waitText).first().waitFor({ timeout: 15000 });
    }

    await page.addStyleTag({ content: STABILIZE_CSS });
    if (dark) {
      await page.evaluate("document.documentElement.classList.add('dark')");
    }

    await page.evaluate("document.fonts.ready");
    if (fontCheck && fonts.length) {
      const missing = await page.evaluate((families) =>
        families.filter((family) => !document.fonts.check(`400 12px "${family}"`)),
      fonts);
      if (missing.length) {
        throw new Error(
          `Fonts not loaded: ${missing.join(", ")}. A fallback-font capture is a phantom diff. ` +
            "Pass --fonts with the families the story actually renders, or drop --font-check.",
        );
      }
    }

    await page.mouse.move(0, 0);
    for (const selector of hover) {
      await page.locator(selector).first().hover();
      await page.waitForTimeout(200);
    }
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Resolved font stack per element, recorded so a diff failure can name the font cause. */
export async function resolvedFonts(page, selectors) {
  return page.evaluate((list) =>
    list.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing: true };
      const style = getComputedStyle(node);
      return {
        selector,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      };
    }),
  selectors);
}
