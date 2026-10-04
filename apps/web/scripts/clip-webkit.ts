import { join } from "node:path";
import { devices, webkit, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixtureRoutes } from "../tests/browser/feature-map/fixtures";
import { cleanupSteps, loopbackPort } from "../../../scripts/verify/clip-core.mjs";
import { save, type ClipState } from "../../../scripts/verify/clip-runtime";
import type { ClipTarget } from "../../../scripts/verify/clip-targets";

export const defaultWebkitDevice = "iPhone 15";
const supported = "open|goto <url>, click <selector>, fill|type <selector> <text>, press <key>, hover <selector>, scroll|swipe <up|down> [px], wait <ms|selector>, wait --fn <js>, eval <js>, snapshot, screenshot <path>, get url|title";

export function webkitDevice(name = defaultWebkitDevice) {
  if (!Object.hasOwn(devices, name)) throw new Error(`Unknown Playwright device: ${name}. Choices include: iPhone 15, iPhone 15 Pro, iPhone 15 Pro Max, iPhone 15 landscape`);
  return { name, profile: devices[name]! };
}

export function webkitVideoSize(viewport: { width: number; height: number }, dpr: number) {
  if (![viewport.width, viewport.height, dpr].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Invalid WebKit video geometry");
  const scale = Math.min(dpr, 2160 / Math.max(viewport.width, viewport.height));
  return { width: Math.max(2, Math.floor(viewport.width * scale / 2) * 2), height: Math.max(2, Math.floor(viewport.height * scale / 2) * 2) };
}

export function validateWebkitCommand(args: string[]) {
  const [command, ...values] = args;
  const fail = () => { throw new Error(`Unsupported WebKit command or arguments. Supported: ${supported}. Selectors: CSS, text=…, role=button[name="…"]; no @eN refs. Recording, close and viewport changes belong to clip.`); };
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
    case "scroll": await page.mouse.wheel(0, (first === "up" ? -1 : 1) * Number(second || 500)); break;
    case "swipe":
      await page.evaluate(({ direction, distance }) => {
        const x = innerWidth / 2, y = innerHeight / 2;
        const target = document.elementFromPoint(x, y) ?? document.body;
        const delta = (direction === "up" ? -1 : 1) * distance;
        const touch = (clientY: number) => new Touch({ identifier: 1, target, clientX: x, clientY });
        const emit = (type: string, clientY: number, ended = false) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: ended ? [] : [touch(clientY)], targetTouches: ended ? [] : [touch(clientY)], changedTouches: [touch(clientY)] }));
        emit("touchstart", y);
        emit("touchmove", y - delta);
        let scroller: Element | null = target;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        (scroller ?? document.scrollingElement)?.scrollBy({ top: delta, behavior: "smooth" });
        emit("touchend", y - delta, true);
      }, { direction: first, distance: Number(second || 500) });
      break;
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
      context = await browser.newContext({ ...profile, recordVideo: { dir: directory, size: webkitVideoSize(profile.viewport, profile.deviceScaleFactor) }, serviceWorkers: "block" });
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
      await page.evaluate('(async () => { const marker = document.createElement("div"); marker.style.cssText = "all:initial;position:fixed;left:0;top:0;width:100vw;height:64px;background:rgb(17,233,71);z-index:2147483647;pointer-events:none"; document.documentElement.append(marker); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise(resolve => setTimeout(resolve, 600)); marker.remove(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()');
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
