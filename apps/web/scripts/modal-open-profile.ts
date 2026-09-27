import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium, type Page, type Request } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "../tests/browser/fixtures/api";

const options = new Map<string, string>();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]!.startsWith("--") || args[i + 1] === undefined) throw new Error(`Unexpected argument: ${args[i]}`);
  options.set(args[i]!.slice(2), args[i + 1]!);
}
const option = (key: string, fallback: string) => options.get(key) ?? fallback;
const integer = (key: string, fallback: number) => {
  const value = Number(option(key, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid --${key}`);
  return value;
};
const flow = option("flow", "add-money");
const viewport = option("viewport", "mobile");
const throttle = integer("cpu-throttle", 4);
const cache = option("cache", "cold");
const chunkDelay = integer("chunk-delay", 0);
const apiDelay = integer("api-delay", 0);
const network = option("network", "none");
const repeat = integer("repeat", 1);
const browserMode = option("browser", "chromium");
const baseUrl = option("base-url", `http://127.0.0.1:${process.env.HOME_FIXTURE_PORT ?? "3199"}`);
const profilePath = options.get("cpu-profile");
const valid = new Set(["flow", "viewport", "cpu-throttle", "cache", "chunk-delay", "api-delay", "network", "repeat", "out", "base-url", "cpu-profile", "browser"]);
if ([...options.keys()].some((key) => !valid.has(key)) || !["add-money", "send"].includes(flow) ||
  !["mobile", "desktop"].includes(viewport) || ![1, 4, 6].includes(throttle) ||
  !["cold", "warm"].includes(cache) || !["slow4g", "none"].includes(network) ||
  repeat < 1 || !["chromium", "chrome", "shell", "headed"].includes(browserMode) || (profilePath && (repeat !== 1 || cache !== "cold"))) throw new Error("Invalid profiling options");
const url = new URL(baseUrl);
if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
  throw new Error("Use a loopback HTTP fixture server only");
}
const origin = url.origin;
const round = (value: number) => Math.round(value * 100) / 100;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length % 2 ? round(sorted[Math.floor(sorted.length / 2)]!) : round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
};
const isJs = (url: string) => /\/_next\/static\/chunks\/[^?]+\.js(?:\?|$)/.test(url);

type ObservedRequest = { url: string; start: number; end?: number; bytes?: number; failed?: string };
type TapSample = {
  input: { event: string; source: string; start: number; processingStart: number | null; processingEnd: number | null; duration: number | null; nextPaint: number | null };
  handlerMs: number | null; handlerSource: string; domMs: number | null; firstVisibleMs: number | null; settledMs: number | null; actionableMs: number | null;
  focusAtSettle: string | null; longTasks: { count: number; totalMs: number; longestMs: number };
  loaf: { count: number; blockingMs: number; longestMs: number };
};

type Probe = { arm: (flow: string) => Promise<void>; result: () => Promise<TapSample> };
async function probe(page: Page): Promise<Probe> {
  await page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100;
    type EventEntry = PerformanceEntry & { processingStart: number; processingEnd: number; duration: number };
    const w = window as typeof window & { __modalProbe?: { arm: (flow: string) => void; result: () => Promise<TapSample> } };
    let started = 0;
    let activeFlow = "";
    let dom = 0, visible = 0, settled = 0, actionable = 0;
    let focus: string | null = null;
    let lastBounds = "", stableFrames = 0, lastPopup: HTMLElement | null = null;
    const captured: { name: string; start: number; captureAt: number; bubble: number }[] = [];
    let events: EventEntry[] = [], tasks: PerformanceEntry[] = [], loafs: (PerformanceEntry & { blockingDuration?: number })[] = [];
    const eventObserver = new PerformanceObserver((list) => { events.push(...list.getEntries() as EventEntry[]); });
    eventObserver.observe({ type: "event", buffered: false });
    const taskObserver = new PerformanceObserver((list) => { tasks.push(...list.getEntries()); });
    taskObserver.observe({ type: "longtask", buffered: false });
    if (PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) {
      const loafObserver = new PerformanceObserver((list) => { loafs.push(...list.getEntries() as typeof loafs); });
      loafObserver.observe({ type: "long-animation-frame", buffered: false });
    }
    const relevant = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      return target?.textContent?.trim() === (activeFlow === "send" ? "Send" : "Add money") && !target.hasAttribute("disabled");
    };
    for (const name of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(name, (event) => {
        if (started && relevant(event)) captured.push({ name, start: event.timeStamp, captureAt: performance.now(), bubble: 0 });
      }, true);
      document.addEventListener(name, (event) => {
        if (started && relevant(event)) {
          const entry = captured.findLast((item) => item.name === name && !item.bubble);
          if (entry) entry.bubble = performance.now();
        }
      });
    }
    const mutation = new MutationObserver(() => {
      if (started && !dom && document.querySelector("[data-money-sheet]")) dom = performance.now();
    });
    mutation.observe(document.documentElement, { childList: true, subtree: true });
    const check = (time: number) => {
      if (started) {
        const popup = document.querySelector<HTMLElement>("[data-money-sheet]");
        if (popup) {
          dom ||= performance.now();
          if (popup !== lastPopup) {
            lastPopup = popup;
            lastBounds = "";
            stableFrames = settled = 0;
            focus = null;
          }
          const rect = popup.getBoundingClientRect();
          const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
          const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
          if (width * height > 0.5 && getComputedStyle(popup).visibility !== "hidden") {
            visible ||= time;
            const bounds = [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n * 4) / 4).join(",");
            if (bounds === lastBounds) stableFrames += 1;
            else {
              stableFrames = settled = 0;
              focus = null;
            }
            lastBounds = bounds;
            if (!settled && stableFrames >= 3 && !popup.getAnimations().some((a) => a.playState === "running")) {
              settled = time;
              const element = document.activeElement;
              focus = element instanceof HTMLElement ? `${element.tagName.toLowerCase()}${element.getAttribute("aria-label") ? `[aria-label="${element.getAttribute("aria-label")}"]` : ""}${element.hasAttribute("data-money-step") ? `[data-money-step="${element.getAttribute("data-money-step")}"]` : ""}` : null;
            }
          } else stableFrames = 0;
          if (!actionable) {
            if (activeFlow === "send" && popup.querySelector<HTMLInputElement>("[data-money-amount-input]:not(:disabled)")) actionable = performance.now();
            if (activeFlow === "add-money" && [...popup.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].some((button) => /^Deposit [A-Z]{3}/.test(button.textContent?.trim() ?? ""))) actionable = performance.now();
          }
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
    w.__modalProbe = {
      arm(nextFlow) {
        activeFlow = nextFlow;
        dom = visible = settled = actionable = started = 0;
        focus = lastBounds = "";
        stableFrames = 0;
        lastPopup = null;
        captured.length = 0;
        events = []; tasks = []; loafs = [];
        started = performance.now();
      },
      async result() {
        const deadline = performance.now() + 16_000;
        while ((!captured.some((item) => item.name === "pointerdown") || !dom || !visible || !settled || !actionable) && performance.now() < deadline) {
          await new Promise<void>((done) => setTimeout(done, 20));
        }
        await new Promise<void>((done) => setTimeout(done, 80));
        const first = captured.find((item) => item.name === "pointerdown") ?? captured.find((item) => item.name === "click");
        if (!first) throw new Error("No real input event captured for modal trigger");
        const tapEnd = Math.max(settled, actionable, visible, performance.now() - 80);
        const entries = captured.map((capture) => ({ capture, entry: events.find((event) => event.name === capture.name && Math.abs(event.startTime - capture.start) < 30) }));
        const click = entries.find((value) => value.capture.name === "click");
        const chosen = entries.find((value) => value.capture.name === "pointerdown") ?? click!;
        const input = chosen.entry;
        const handlers = entries.filter((value) => value.capture.name === "pointerdown" || value.capture.name === "click");
        const precise = handlers.every((value) => value.entry !== undefined);
        const handlerMs = precise ? handlers.reduce((sum, value) => sum + value.entry!.processingEnd - value.entry!.processingStart, 0) :
          handlers.every((value) => value.capture.bubble > 0) ? handlers.reduce((sum, value) => sum + value.capture.bubble - value.capture.captureAt, 0) : null;
        const start = input?.startTime ?? first.start;
        const relevantTasks = tasks.filter((entry) => entry.startTime >= start && entry.startTime < tapEnd);
        const relevantLoafs = loafs.filter((entry) => entry.startTime >= start && entry.startTime < tapEnd);
        started = 0;
        return {
          input: { event: chosen.capture.name, source: input ? "Event Timing" : "capture fallback", start,
            processingStart: input?.processingStart ?? null, processingEnd: input?.processingEnd ?? null,
            duration: input?.duration ?? null, nextPaint: input ? input.startTime + input.duration : null },
          handlerMs: handlerMs === null ? null : round(handlerMs),
          handlerSource: precise ? "Event Timing" : "capture-to-bubble estimate",
          domMs: dom ? round(dom - start) : null, firstVisibleMs: visible ? round(visible - start) : null,
          settledMs: settled ? round(settled - start) : null, actionableMs: actionable ? round(actionable - start) : null,
          focusAtSettle: focus,
          longTasks: { count: relevantTasks.length, totalMs: round(relevantTasks.reduce((sum, item) => sum + item.duration, 0)), longestMs: round(Math.max(0, ...relevantTasks.map((item) => item.duration))) },
          loaf: { count: relevantLoafs.length, blockingMs: round(relevantLoafs.reduce((sum, item) => sum + (item.blockingDuration ?? 0), 0)), longestMs: round(Math.max(0, ...relevantLoafs.map((item) => item.duration))) },
        };
      },
    };
  });
  return {
    arm: (nextFlow) => page.evaluate((value) => (window as typeof window & { __modalProbe: Probe }).__modalProbe.arm(value), nextFlow),
    result: () => page.evaluate(() => (window as typeof window & { __modalProbe: Probe }).__modalProbe.result()),
  };
}

function summarizeProfile(profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples?: number[]; timeDeltas?: number[] }) {
  const costs = new Map<number, number>();
  profile.samples?.forEach((id, index) => costs.set(id, (costs.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0)));
  return profile.nodes.map((node) => ({ function: node.callFrame.functionName || "(anonymous)", source: node.callFrame.url.split("/").at(-1), line: node.callFrame.lineNumber + 1, selfMs: round((costs.get(node.id) ?? 0) / 1000) }))
    .filter((node) => node.selfMs > 0).sort((a, b) => b.selfMs - a.selfMs).slice(0, 15);
}

async function runOnce(index: number) {
  const browser = await chromium.launch(browserMode === "headed" ? { headless: false } : { headless: true, ...(browserMode === "shell" ? {} : { channel: browserMode }) });
  const context = await browser.newContext({
    viewport: viewport === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(viewport === "mobile" ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests: ObservedRequest[] = [];
  const tracked = new Map<Request, ObservedRequest>();
  page.on("request", (request) => {
    const entry = { url: request.url(), start: Date.now() };
    requests.push(entry); tracked.set(request, entry);
  });
  page.on("requestfinished", async (request) => {
    const entry = tracked.get(request);
    if (!entry) return;
    entry.end = Date.now();
    try { entry.bytes = (await request.sizes()).responseBodySize; } catch { entry.bytes = 0; }
  });
  page.on("requestfailed", (request) => {
    const entry = tracked.get(request);
    if (entry) { entry.end = Date.now(); entry.failed = request.failure()?.errorText; }
  });
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    if (network === "slow4g") {
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 95_000 });
    }
    if (cache === "cold") await page.addInitScript(() => {
      const idle = window.requestIdleCallback.bind(window);
      const cancel = window.cancelIdleCallback.bind(window);
      let next = 0;
      const queued = new Set<number>();
      window.requestIdleCallback = ((_callback: IdleRequestCallback) => { const id = ++next; queued.add(id); return id; }) as typeof window.requestIdleCallback;
      window.cancelIdleCallback = ((id: number) => { queued.delete(id); }) as typeof window.cancelIdleCallback;
      document.addEventListener("pointerdown", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button?.textContent?.trim() !== "Add money" && button?.textContent?.trim() !== "Send") return;
        window.requestIdleCallback = idle;
        window.cancelIdleCallback = cancel;
        queued.clear();
      }, true);
    });
    await seedSignedInSession(page, "ID");
    await installApiFixtures(page, { countryPreferenceRegion: "ID" });
    if (apiDelay) await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/funding/") || (flow === "send" && path === "/api/actions/network-fee")) await sleep(apiDelay);
      await route.fallback();
    });
    if (chunkDelay) await page.route("**/_next/static/chunks/*.js*", async (route) => {
      const response = await route.fetch();
      await sleep(chunkDelay);
      await route.fulfill({ response });
    });
    const trigger = page.getByRole("button", { name: flow === "send" ? "Send" : "Add money", exact: true }).first();
    const selector = "[data-money-sheet]";
    const loadAt = Date.now();
    await page.goto(`${origin}/home`, { waitUntil: "domcontentloaded" });
    await trigger.waitFor({ state: "visible", timeout: 30_000 });
    await trigger.waitFor({ state: "attached" });
    await page.waitForFunction((name) => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === name);
      return button && !button.disabled && performance.getEntriesByName("action:first-interactive", "mark").length > 0;
    }, flow === "send" ? "Send" : "Add money", { timeout: 30_000 });
    const enabledAt = Date.now();
    let networkIdleAt = 0;
    if (cache === "warm") {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
      networkIdleAt = Date.now();
      await sleep(3_000);
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    }
    const idleAt = Date.now();
    const probeInstance = await probe(page);
    const tap = async (name: "first" | "reopen") => {
      await probeInstance.arm(flow);
      if (name === "first" && profilePath) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      if (viewport === "mobile") await trigger.tap({ timeout: 15_000 });
      else await trigger.click({ timeout: 15_000 });
      const sample = await probeInstance.result();
      let cpuTop: ReturnType<typeof summarizeProfile> | undefined;
      if (name === "first" && profilePath) {
        const { profile } = await cdp.send("Profiler.stop");
        await mkdir(dirname(resolve(profilePath)), { recursive: true });
        await writeFile(resolve(profilePath), JSON.stringify(profile));
        cpuTop = summarizeProfile(profile);
      }
      if ([sample.domMs, sample.firstVisibleMs, sample.settledMs, sample.actionableMs].some((item) => item === null)) {
        throw new Error(`Missing ${name} milestone: ${JSON.stringify(sample)}; diagnostic=${JSON.stringify(await page.evaluate(() => ({ location: location.href, country: localStorage.getItem("home.country.v2"), dialog: document.querySelector("[data-money-sheet]")?.textContent?.slice(0, 600), buttons: [...(document.querySelector("[data-money-sheet]")?.querySelectorAll("button") ?? [])].map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })) })))}; api=${JSON.stringify(requests.filter((entry) => new URL(entry.url).pathname.startsWith("/api/")).map((entry) => new URL(entry.url).pathname + new URL(entry.url).search))}`);
      }
      const startWall = sample.input.start + await page.evaluate(() => performance.timeOrigin);
      const windowEnd = startWall + Math.max(sample.settledMs!, sample.actionableMs!);
      const afterTap = requests.filter((request) => request.start >= startWall && request.start <= windowEnd);
      return { ...sample, chunks: afterTap.filter((request) => isJs(request.url)).map((request) => ({ basename: new URL(request.url).pathname.split("/").at(-1), bytes: request.bytes ?? null, startMs: round(request.start - startWall), endMs: request.end ? round(request.end - startWall) : null, durationMs: request.end ? request.end - request.start : null })),
        apiPaths: afterTap.filter((request) => new URL(request.url).pathname.startsWith("/api/")).map((request) => new URL(request.url).pathname), ...(cpuTop ? { cpuTop } : {}) };
    };
    const preTapChunks = requests.filter((request) => isJs(request.url) && request.start >= loadAt && request.start < networkIdleAt);
    const idleChunks = requests.filter((request) => isJs(request.url) && request.start >= enabledAt && request.start < idleAt);
    const beforeTapChunks = requests.filter((request) => isJs(request.url) && request.start >= loadAt && request.start < idleAt);
    const first = await tap("first");
    const close = page.getByRole("button", { name: flow === "send" ? "Close send dialog" : "Close add money" });
    if (viewport === "mobile") await close.tap(); else await close.click();
    await page.locator(selector).waitFor({ state: "detached", timeout: 15_000 });
    const reopen = await tap("reopen");
    return {
      repetition: index, flow, viewport, throttle, cache, chunkDelay, apiDelay, network,
      fixtureRegion: await page.evaluate(() => localStorage.getItem("home.country.v2")),
      preTapChunks: beforeTapChunks.map((request) => ({ basename: new URL(request.url).pathname.split("/").at(-1), bytes: request.bytes ?? null, afterEnabled: request.start >= enabledAt })),
      load: cache === "warm" ? { jsRequests: preTapChunks.length, jsBytes: preTapChunks.reduce((sum, request) => sum + (request.bytes ?? 0), 0), idlePreloadChunks: idleChunks.map((request) => ({ basename: new URL(request.url).pathname.split("/").at(-1), bytes: request.bytes ?? null })) } : null,
      first, reopen,
    };
  } finally { await context.close(); await browser.close(); }
}

const rows: Awaited<ReturnType<typeof runOnce>>[] = [];
for (let i = 1; i <= repeat; i++) rows.push(await runOnce(i));
const metrics = ["handlerMs", "domMs", "firstVisibleMs", "settledMs", "actionableMs"] as const;
const summary = Object.fromEntries(["first", "reopen"].map((phase) => [phase, Object.fromEntries(metrics.map((key) => [key, median(rows.map((row) => row[phase as "first" | "reopen"][key]).filter((value): value is number => value !== null))]))]));
const output = { options: { flow, viewport, throttle, cache, chunkDelay, apiDelay, network, repeat, origin, region: "ID" }, measurement: {
  firstVisible: "first rAF with popup intersection > 0.5px²; rAF callback is not proof of compositor presentation",
  settled: "popup bounds stable (0.25px quantization) for 3 consecutive rAFs with no running popup animations; restarts whenever the popup element is replaced or its bounds change",
  actionable: flow === "send" ? "enabled [data-money-amount-input] exists" : "enabled Deposit <currency> method button exists (ID fixture)",
  cold: "wait for action:first-interactive hydration mark, suppress page requestIdleCallback callbacks until trigger pointerdown, then restore; avoids idle-preload racing the cold tap but also defers other idle work",
  warm: "wait for first network idle, then 3 seconds and network idle again; load totals end at first network idle; idlePreloadChunks are post-enable requests before tap",
  preTapChunks: "all JS chunks requested before the first input, including chunks requested before the hydration mark",
  chunkDelay: "all /_next/static/chunks/*.js responses (including initial page load)",
  apiDelay: "funding endpoints and, for send, /api/actions/network-fee (fixture route fallback)",
  handler: "pointerdown + click Event Timing processing intervals when both available; otherwise capture-to-bubble propagation estimates",
}, medians: summary, rows };
if (options.has("out")) { await mkdir(dirname(resolve(options.get("out")!)), { recursive: true }); await writeFile(resolve(options.get("out")!), JSON.stringify(output, null, 2) + "\n"); }
console.log(JSON.stringify({ medians: summary, load: rows[0]?.load, first: rows[0]?.first, reopen: rows[0]?.reopen }, null, 2));
