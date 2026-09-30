import { expect, test } from "@playwright/test";
import { setCpuRate, type Session } from "../../scripts/performance/browser";
import { feedScrollHost, fillFeed, fling } from "../../scripts/performance/feed";

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
    await page.evaluate(() => { (window as typeof window & { __perfHistory: number }).__perfHistory = 0; });
    const position = { x: 195, y: 422 };
    expect(await page.evaluate(feedScrollHost, position)).toMatchObject({ host });
    await page.evaluate((selected) => {
      const node = selected === "main" ? document.querySelector<HTMLElement>("main[data-app-main-authenticated]")! : document.scrollingElement!;
      node.scrollTop = 200;
      const w = window as typeof window & { __maxScroll: number };
      w.__maxScroll = 0;
      const record = () => { w.__maxScroll = Math.max(w.__maxScroll, node.scrollTop); };
      if (selected === "main") node.addEventListener("scroll", record);
      else window.addEventListener("scroll", record);
    }, host);
    const session = { page, cdp, cpu: { requested: 4, applied: 1 } } as Session;
    await setCpuRate(session, 4);
    const result = await fling(session);
    const observed = await page.evaluate((selected) => ({
      max: (window as typeof window & { __maxScroll: number }).__maxScroll,
      top: selected === "main" ? document.querySelector<HTMLElement>("main[data-app-main-authenticated]")!.scrollTop : window.scrollY,
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
    const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]")!;
    return main.scrollHeight - main.clientHeight;
  })).toBeGreaterThan(64);
  const session = { page, cdp: await context.newCDPSession(page) } as Session;
  await expect(fling(session)).rejects.toThrow("Fling selected non-scrollable document scroll host");
});

test("feed scroll host ignores a non-scrollable main and a main outside the gesture", async ({ page }) => {
  await page.setContent(`${viewportMeta}<style>body { margin: 0 } main { height: 200px; overflow-y: auto } li { height: 40px }</style><main data-app-main-authenticated><ul><li>One</li></ul></main>`);
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 100 })).toMatchObject({ host: "document" });
  await page.evaluate(() => { document.querySelector("ul")!.innerHTML = "<li>More</li>".repeat(100); });
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 422 })).toMatchObject({ host: "document" });
  expect(await page.evaluate(feedScrollHost, { x: 195, y: 100 })).toMatchObject({ host: "main" });
});

for (const host of ["main", "document"] as const) {
  test(`fillFeed paginates through the ${host} scroll host`, async ({ page, context }) => {
    const loaded: number[] = [];
    await page.exposeFunction("feedPageLoaded", (number: number) => { loaded.push(number); });
    const style = host === "main"
      ? "body { margin: 0; overflow: hidden } main { height: 100vh; overflow-y: auto }"
      : "body { margin: 0 } main { overflow-y: visible }";
    await page.setContent(`${viewportMeta}<style>${style}</style>${activityMarkup(rows(25, 48))}`);
    await page.evaluate((selected) => {
      const main = document.querySelector<HTMLElement>("main[data-app-main-authenticated]")!;
      const scroller = selected === "main" ? main : document.scrollingElement!;
      const target = selected === "main" ? main : window;
      let next = 2;
      target.addEventListener("scroll", () => {
        if (next > 3 || scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 5) return;
        const list = document.querySelector("section ul")!;
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
        void (window as typeof window & { feedPageLoaded: (number: number) => Promise<void> }).feedPageLoaded(next++);
      });
    }, host);
    const session = { page, cdp: await context.newCDPSession(page), cpu: { requested: 4, applied: 1 } } as Session;
    await fillFeed(session, 75, () => loaded.length === 2);
    expect(loaded).toEqual([2, 3]);
    expect(await page.locator('section[aria-label="Activity"] ul li').count()).toBe(75);
    expect(await page.locator('section[aria-label="Activity"] [role="status"]').isVisible()).toBe(true);
    const scroll = await page.evaluate(() => ({ main: document.querySelector<HTMLElement>("main")!.scrollTop, document: window.scrollY }));
    expect(scroll[host]).toBeGreaterThan(0);
    expect(scroll[host === "main" ? "document" : "main"]).toBe(0);
    expect(session.cpu.applied).toBe(4);
  });
}
