import { join } from "node:path";
import { devices, webkit, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixtureRoutes } from "../tests/browser/feature-map/fixtures";
import { cleanupSteps, loopbackPort } from "../../../scripts/verify/clip-core.mjs";
import { save, type ClipState } from "../../../scripts/verify/clip-runtime";
import type { ClipTarget } from "../../../scripts/verify/clip-targets";

export const defaultWebkitDevice = "iPhone 15";
const supported = "open|goto <url>, click <selector>, fill|type <selector> <text>, press <key>, hover <selector>, scroll|swipe <up|down> [px], wait <ms|selector>, wait --fn <js>, eval <js>, snapshot, screenshot <path>, get url|title";

export function webkitDevice(name = defaultWebkitDevice) {
  const valid = Object.keys(devices).filter((device) => {
    const profile = devices[device]!;
    return profile.defaultBrowserType === "webkit" && profile.hasTouch && profile.isMobile;
  });
  if (!valid.includes(name)) throw new Error(`Unsupported Playwright mobile WebKit device: ${name}. Valid devices: ${valid.join(", ")}`);
  return { name, profile: devices[name]! };
}

export function webkitVideoSize(viewport: { width: number; height: number }) {
  if (![viewport.width, viewport.height].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid WebKit video geometry");
  return { ...viewport };
}

export function validateWebkitCommand(args: string[]) {
  const [command, ...values] = args;
  const fail = () => { throw new Error(`Unsupported WebKit command or arguments. Supported: ${supported}. Selectors: CSS, text=…, role=button[name="…"]; no @eN refs. Recording, close and viewport changes belong to clip.`); };
  if (values.some((value, index) => value.startsWith("--") && !(command === "wait" && index === 0 && value === "--fn"))) throw new Error("WebKit arguments cannot start with --; only wait --fn <js> supports a flag");
  const arity = { open: 1, goto: 1, click: 1, fill: 2, type: 2, press: 1, hover: 1, eval: 1, snapshot: 0, screenshot: 1, get: 1 };
  if (Object.hasOwn(arity, command)) {
    if (values.length !== arity[command as keyof typeof arity]) fail();
    if (command === "get" && !["url", "title"].includes(values[0]!)) fail();
  } else if (["scroll", "swipe"].includes(command!)) {
    if (values.length < 1 || values.length > 2 || !["up", "down"].includes(values[0]!)) fail();
    if (values[1] !== undefined && (!/^\d+$/.test(values[1]) || !Number.isSafeInteger(Number(values[1])))) fail();
  } else if (command === "wait") {
    if (!(values.length === 1 && values[0] && !values[0].startsWith("--")) && !(values.length === 2 && values[0] === "--fn" && values[1])) fail();
    if (values.length === 1 && /^\d+$/.test(values[0]!) && !Number.isSafeInteger(Number(values[0]))) fail();
  } else fail();
  if (["click", "fill", "type", "hover"].includes(command!) || (command === "wait" && values.length === 1)) {
    if (/^@e?\d+$/.test(values[0]!)) fail();
  }
}

export async function driveWebkit(page: Page, args: string[]): Promise<unknown> {
  validateWebkitCommand(args);
  const [command, first = "", second = ""] = args;
  switch (command) {
    case "open": case "goto": await page.goto(first, { waitUntil: "domcontentloaded" }); return page.url();
    case "click": await page.locator(first).click(); break;
    case "fill": await page.locator(first).fill(second); break;
    case "type": await page.locator(first).pressSequentially(second); break;
    case "press": await page.keyboard.press(first); break;
    case "hover": await page.locator(first).hover(); break;
    case "scroll": case "swipe": {
      const scroll = await page.evaluateHandle(({ direction, distance }) => {
        const documentScroller = document.scrollingElement;
        let scroller = documentScroller;
        if (!scroller || scroller.scrollHeight <= scroller.clientHeight) {
          let ancestor = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          let largestArea = 0;
          while (ancestor) {
            const area = ancestor.clientWidth * ancestor.clientHeight;
            if (ancestor.scrollHeight > ancestor.clientHeight && /auto|scroll/.test(getComputedStyle(ancestor).overflowY) && area > largestArea) {
              scroller = ancestor;
              largestArea = area;
            }
            ancestor = ancestor.parentElement;
          }
        }
        if (!scroller) throw new Error("No scrolling element found");
        const top = (direction === "up" ? -1 : 1) * (distance ?? Math.round(innerHeight * 0.65));
        const start = scroller.scrollTop;
        const target = Math.max(0, Math.min(start + top, scroller.scrollHeight - scroller.clientHeight));
        scroller.scrollBy({ top, behavior: "smooth" });
        return { scroller, last: start, stable: 0, moved: false, atEdge: target === start };
      }, { direction: first, distance: second ? Number(second) : command === "scroll" ? 500 : null });
      try {
        await page.waitForFunction((state) => {
          const top = state.scroller.scrollTop;
          state.moved ||= top !== state.last;
          state.stable = top === state.last ? state.stable + 1 : 0;
          state.last = top;
          return (state.moved || state.atEdge) && state.stable >= 6;
        }, scroll, { polling: "raf" });
      } finally { await scroll.dispose(); }
      break;
    }
    case "wait":
      if (first === "--fn") await page.waitForFunction(second);
      else if (/^\d+$/.test(first)) await page.waitForTimeout(Number(first));
      else await page.locator(first).waitFor({ state: "visible" });
      break;
    case "eval": return page.evaluate(first);
    case "snapshot": return page.locator("body").ariaSnapshot();
    case "screenshot": await page.screenshot({ path: first }); return first;
    case "get": return first === "url" ? page.url() : page.title();
  }
  return "OK";
}

const defaults = { webkit, save };
export function webkitTarget(state: ClipState, directory: string, dependencies: Partial<typeof defaults> = {}): ClipTarget {
  const deps = { ...defaults, ...dependencies };
  let browser: Browser | undefined, context: BrowserContext | undefined, page: Page | undefined;
  const closeContext = async () => { if (context) { await context.close(); context = undefined; } };
  return {
    async start() {
      const { name, profile } = webkitDevice(state.device);
      state.device = name;
      state.viewport = profile.viewport;
      let url = state.url;
      if (state.fixture) {
        url ??= `http://127.0.0.1:${process.env.HOME_FIXTURE_PORT || 3199}/home`;
        if (!loopbackPort(url) || new URL(url).protocol !== "http:") throw new Error("--fixture requires a loopback HTTP fixture URL");
        url = new URL("/home", url).href;
      }
      state.url = url;
      browser = await deps.webkit.launch({ headless: true });
      state.webkitVersion = browser.version();
      context = await browser.newContext({ ...profile, recordVideo: { dir: directory, size: webkitVideoSize(profile.viewport) }, serviceWorkers: "block" });
      context.setDefaultTimeout(30000);
      context.setDefaultNavigationTimeout(60000);
      if (state.fixture) {
        await context.addInitScript('sessionStorage.setItem("home:playwright-smoke:signed-in","1");localStorage.setItem("home.country.v2","US");');
        for (const [pattern, body] of fixtureRoutes({ prepare: state.fixture })) {
          await context.route(pattern, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
        }
      }
      page = await context.newPage();
      if (!url) await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1">');
      if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
      if (state.fixture) await page.locator("[data-app-main-authenticated]").waitFor({ state: "visible", timeout: 90000 });
      state.css = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, outerWidth, dpr: devicePixelRatio }));
      state.browserAttached = true;
      await deps.save(join(directory, "state.json"), state);
    },
    async command(args) { if (!page) throw new Error("WebKit page is not running"); return driveWebkit(page, args); },
    async monitor() { if (!browser?.isConnected() || page?.isClosed()) throw new Error("WebKit browser ended early; recording discarded"); },
    async stop() {
      const video = page?.video();
      if (!video) throw new Error("WebKit recording contains no video");
      await closeContext();
      await video.saveAs(state.raw);
    },
    async cleanup() {
      await cleanupSteps([
        ["WebKit context", closeContext],
        ["WebKit browser", async () => { if (browser) { await browser.close(); browser = undefined; } }],
      ]);
    },
  };
}
