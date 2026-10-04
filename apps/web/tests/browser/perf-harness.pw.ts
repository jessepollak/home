import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { setCpuRate, type Session } from "../../scripts/performance/browser";
import { feedScrollHost, fillFeed, fling, resetFeedScroll } from "../../scripts/performance/feed";

/**
 * The profiler harness drives real scroll, gesture and CPU-throttle behavior, so it runs in the
 * browser suite; hosted runners cold-compile the fixture app, so give it a CI-sized budget.
 */
test.describe.configure({ timeout: 120_000 });

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const viewportMeta = '<meta name="viewport" content="width=device-width, initial-scale=1">';

const rows = (count: number, height: number, positioned = false) =>
  Array.from({ length: count }, (_, index) =>
    `<li${positioned ? ` aria-posinset="${index + 1}"` : ""} style="height: ${height}px">Row ${index + 1}</li>`).join("");

const activityMarkup = (rows: string) =>
  `<main data-app-main-authenticated><section aria-label="Activity"><ul>${rows}</ul></section></main>`;

for (const host of ["main", "document"] as const) {
  test(`fling selects and measures the ${host} scroll host`, async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    const style = host === "main"
      ? "body { margin: 0; overflow: hidden } main { height: 100vh; overflow-y: auto }"
      : "body { margin: 0 } main { overflow-y: visible }";
    await page.setContent(`${viewportMeta}<style>${style}</style>${activityMarkup(rows(300, 40, true))}`);
    await page.evaluate(() => { Reflect.set(window, "__perfHistory", 0); });
    const position = { x: 195, y: 422 };
    expect(await page.evaluate(feedScrollHost, position)).toMatchObject({ host });
    await page.evaluate((selected) => {
      const node = selected === "main" ? document.querySelector<HTMLElement>("main[data-app-main-authenticated]") : document.scrollingElement;
      if (!node) throw new Error(`missing ${selected} scroll host`);
      node.scrollTop = 200;
      let max = 0;
      Reflect.set(window, "__maxScroll", max);
      const record = () => { max = Math.max(max, node.scrollTop); Reflect.set(window, "__maxScroll", max); };
      if (selected === "main") node.addEventListener("scroll", record);
      else window.addEventListener("scroll", record);
    }, host);
    const session: Session = { page, context, cdp, cpu: { requested: 4, applied: 1 } };
    await setCpuRate(session, 4);
    const result = await fling(session);
    const observed = await page.evaluate((selected) => ({
      max: Number(Reflect.get(window, "__maxScroll")),
      top: selected === "main" ? document.querySelector<HTMLElement>("main[data-app-main-authenticated]")?.scrollTop ?? Number.NaN : window.scrollY,
      documentTop: window.scrollY,
    }), host);
    expect(result.scrollHost).toBe(host);
    expect(result.settledRows).toBe(300);
    expect(observed.max).toBeGreaterThanOrEqual(500);
    expect(observed.top).toBeLessThanOrEqual(64);
    if (host === "main") expect(observed.documentTop).toBe(0);
    expect(session.cpu.applied).toBe(4);
  });
}

test("fling rejects when a narrow scrollable main is outside the gesture and the document cannot scroll", async ({ page, context }) => {
  await page.setContent(`${viewportMeta}<style>body { margin: 0; overflow: hidden } main { width: 140px; height: 100vh; overflow-y: auto }</style>${activityMarkup(rows(100, 40))}`);
  const scroll = await page.evaluate(feedScrollHost, { x: 195, y: 422 });
  expect(scroll.host).toBe("document");
  expect(scroll.height - scroll.viewport).toBeLessThanOrEqual(64);
  expect(await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]");
    return main ? main.scrollHeight - main.clientHeight : Number.NaN;
  })).toBeGreaterThan(64);
  const session: Session = { page, context, cdp: await context.newCDPSession(page), cpu: { requested: 1, applied: 1 } };
  await expect(fling(session)).rejects.toThrow("Fling selected non-scrollable document scroll host");
});

test("feed scroll host ignores a non-scrollable main and a main outside the gesture", async ({ page }) => {
  await page.setContent(`${viewportMeta}<style>body { margin: 0 } main { height: 200px; overflow-y: auto } li { height: 40px }</style><main data-app-main-authenticated><ul><li>One</li></ul></main>`);
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 100 })).toMatchObject({ host: "document" });
  await page.evaluate(() => {
    const list = document.querySelector("ul");
    if (!list) throw new Error("missing list");
    list.innerHTML = "<li>More</li>".repeat(100);
  });
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 422 })).toMatchObject({ host: "document" });
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 100 })).toMatchObject({ host: "main" });
});

async function paginatedFeed(page: Page, context: BrowserContext, host: "main" | "document") {
  const loaded: number[] = [];
  await page.exposeFunction("feedPageLoaded", (number: number) => { loaded.push(number); });
  const style = host === "main"
    ? "body { margin: 0; overflow: hidden } main { height: 100vh; overflow-y: auto }"
    : "body { margin: 0 } main { overflow-y: visible }";
  await page.setContent(`${viewportMeta}<style>${style}</style>${activityMarkup(rows(25, 48))}`);
  await page.evaluate((selected) => {
    const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]");
    const scroller = selected === "main" ? main : document.scrollingElement;
    const list = document.querySelector("section ul");
    if (!main || !scroller || !list) throw new Error("missing feed fixture");
    const target = selected === "main" ? main : window;
    let next = 2;
    function isPageLoadedCallback(value: unknown): value is (pageNumber: number) => unknown {
      return typeof value === "function";
    }
    target.addEventListener("scroll", () => {
      if (next > 3 || scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 5) return;
      for (let i = 0; i < 25; i++) {
        const row = document.createElement("li");
        row.style.height = "48px";
        row.textContent = `Row ${(next - 1) * 25 + i + 1}`;
        list.appendChild(row);
      }
      if (next === 3) {
        const end = document.createElement("p");
        end.setAttribute("role", "status");
        end.textContent = "End of activity";
        list.after(end);
      }
      const notify: unknown = Reflect.get(window, "feedPageLoaded");
      if (isPageLoadedCallback(notify)) void notify(next++);
    });
  }, host);
  const session: Session = { page, context, cdp: await context.newCDPSession(page), cpu: { requested: 4, applied: 1 } };
  await fillFeed(session, 75, () => loaded.length === 2);
  return { loaded, session };
}

for (const host of ["main", "document"] as const) {
  test(`fillFeed paginates through the ${host} scroll host`, async ({ page, context }) => {
    const { loaded, session } = await paginatedFeed(page, context, host);
    expect(loaded).toEqual([2, 3]);
    expect(await page.locator('section[aria-label="Activity"] ul li').count()).toBe(75);
    expect(await page.locator('section[aria-label="Activity"] [role="status"]').isVisible()).toBe(true);
    const scroll = await page.evaluate(() => ({ main: document.querySelector<HTMLElement>("main")?.scrollTop ?? Number.NaN, document: window.scrollY }));
    expect(scroll[host]).toBeGreaterThan(0);
    expect(scroll[host === "main" ? "document" : "main"]).toBe(0);
    expect(session.cpu.applied).toBe(4);
  });

  test(`resetFeedScroll resets the ${host} scroll host after fillFeed`, async ({ page, context }) => {
    await paginatedFeed(page, context, host);
    const before = await page.evaluate(() => ({
      main: document.querySelector<HTMLElement>("main[data-app-main-authenticated]")?.scrollTop,
      document: window.scrollY,
    }));
    expect(before[host]).toBeGreaterThan(0);
    await resetFeedScroll(page);
    expect(await page.evaluate(() => ({
      main: document.querySelector<HTMLElement>("main[data-app-main-authenticated]")?.scrollTop,
      document: window.scrollY,
    }))).toEqual({ main: 0, document: 0 });
  });
}

test("resetFeedScroll reaches the document top when resetting main alone is a no-op", async ({ page, context }) => {
  await paginatedFeed(page, context, "document");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop = 0; });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await resetFeedScroll(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("resetFeedScroll rejects when the document stays scrolled", async ({ page, context }) => {
  await paginatedFeed(page, context, "document");
  await page.evaluate(() => {
    const root = document.scrollingElement;
    if (!root) throw new Error("missing document scroll host");
    Object.defineProperty(root, "scrollTop", {
      get: () => window.scrollY,
      set: (top: number) => { window.scrollTo(0, Math.max(200, top)); },
    });
  });
  await expect(resetFeedScroll(page)).rejects.toThrow("Feed scroll reset did not reach the top");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
