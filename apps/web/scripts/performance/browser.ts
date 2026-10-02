import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { installApiFixtures, seedSignedInSession } from "../../tests/browser/fixtures/api";
import { cpuThrottle, type GateId } from "./config";
import { installPerformanceFixtures } from "./fixtures";

export type CpuRate = { requested: number; applied: number };
export type Session = { page: Page; context: BrowserContext; cdp: CDPSession; cpu: CpuRate; fixtures?: Awaited<ReturnType<typeof installApiFixtures>> };

export async function setCpuRate(session: Session, rate: number) {
  if (!Number.isFinite(rate) || rate < 1) throw new Error(`Invalid CPU throttle rate ${rate}`);
  await session.cdp.send("Emulation.setCPUThrottlingRate", { rate });
  session.cpu.applied = rate;
}

export async function openSession(browser: Browser, seed: GateId | null, cpuRate = cpuThrottle, options?: { seedBalancesPaintRatio?: number }): Promise<Session> {
  if (!Number.isFinite(cpuRate) || cpuRate < 1) throw new Error(`Invalid CPU throttle rate ${cpuRate}`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const session: Session = { page, context, cdp, cpu: { requested: cpuRate, applied: 1 } };
    await setCpuRate(session, cpuRate);
    await seedSignedInSession(page);
    // The harness measures the real page clock; navigation and modal gates install their own Playwright clock.
    session.fixtures = await installApiFixtures(page, { clock: "system" });
    await installPerformanceFixtures(page);
    await page.addInitScript(({ gate, seedBalancesPaintRatio }) => {
      const w = window as typeof window & { __perfHistory?: number; __perfLeakCycle?: () => void; __perfLeaks?: Element[] };
      w.__perfHistory = 0;
      for (const name of ["pushState", "replaceState"] as const) {
        const original = history[name].bind(history);
        history[name] = ((...args: Parameters<History[typeof name]>) => {
          w.__perfHistory! += 1;
          const result = Reflect.apply(original, history, args);
          if (gate === "warm-requests" && window.location.pathname !== "/home") void fetch("/api/perf-seed");
          return result;
        }) as History[typeof name];
      }
      if (gate === "balances-painted" && seedBalancesPaintRatio !== undefined) {
        const original = performance.mark.bind(performance);
        let requested = false;
        let recorded: PerformanceMark | undefined;
        performance.mark = (name, options) => {
          if (name !== "balances:painted") return original(name, options);
          if (!requested) {
            requested = true;
            const deadline = performance.now() + 15_000;
            const record = () => {
              const shellStart = performance.getEntriesByName("shell:paint", "mark")[0]?.startTime;
              if (shellStart !== undefined) recorded = original(name, { ...options, startTime: 2 * seedBalancesPaintRatio * shellStart });
              else if (performance.now() < deadline) setTimeout(record, 20);
            };
            record();
          }
          // Construction preserves the return type without recording an unscaled entry.
          return recorded ?? new PerformanceMark(name, options);
        };
      }
      if (gate === "history-writes") document.addEventListener("scroll", () => {
        for (let i = 0; i < 6; i++) history.replaceState(history.state, "", location.href);
      }, true);
      if (gate === "resource-growth") w.__perfLeakCycle = () => {
        w.__perfLeaks ??= [];
        for (let i = 0; i < 25; i++) {
          w.__perfLeaks.push(document.createElement("div"));
          window.addEventListener(`perf-leak-${w.__perfLeaks.length}`, () => {});
        }
      };
      if (gate === "dom-nodes") {
        (w as typeof w & { __perfSeedDomNow: () => void }).__perfSeedDomNow = () => {
          const container = document.createElement("div");
          container.hidden = true;
          const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          let count = 1;
          while (walker.nextNode()) count++;
          for (let i = 0; i < Math.ceil(count * 0.2); i++)
            container.appendChild(document.createElement("span")).appendChild(document.createTextNode("seed"));
          document.body.appendChild(container);
        };
      }
      if (gate === "mounted-rows") {
        const observer = new MutationObserver(() => {
          const lists = [...document.querySelectorAll<HTMLElement>('section[aria-label="Activity"] ul, section[data-activity-feed] ul')]
            .filter((list) => list.querySelector("li:not([data-perf-clone])"));
          const list = lists.at(-1);
          if (!list) return;
          const current = list.querySelectorAll("[data-perf-clone]").length;
          if (current >= 30) return;
          const row = list.querySelector("li:not([data-perf-clone])")!;
          for (let i = current; i < 30; i++) {
            const clone = row.cloneNode(true) as HTMLElement;
            clone.dataset.perfClone = "";
            clone.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";
            list.appendChild(clone);
          }
        });
        observer.observe(document, { subtree: true, childList: true });
      }
    }, { gate: seed, seedBalancesPaintRatio: options?.seedBalancesPaintRatio });
    if (seed === "initial-js") {
      const noise = Array.from({ length: 75_000 }, (_, i) => {
        const value = (i * 2654435761 ^ (i * i * 1597334677)) >>> 0;
        return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[value % 62];
      }).join("");
      await page.route("**/_next/static/chunks/perf-seed.js", (route) => route.fulfill({ contentType: "application/javascript", body: `void ${JSON.stringify(noise)};` }));
      await page.route("**/*", async (route) => {
        if (!route.request().isNavigationRequest() || route.request().resourceType() !== "document") return route.fallback();
        const response = await route.fetch();
        const body = await response.text();
        if (!body.includes("</body>")) throw new Error("Cannot seed a non-HTML document");
        await route.fulfill({ response, body: body.replace("</body>", '<script src="/_next/static/chunks/perf-seed.js"></script></body>') });
      });
    }
    return session;
  } catch (error) { await context.close(); throw error; }
}

export async function withSession<T>(browser: Browser, seed: GateId | null, run: (session: Session) => Promise<T>, trace?: { dir: string; name: string }, cpuRate = cpuThrottle, options?: { seedBalancesPaintRatio?: number }): Promise<T> {
  const session = await openSession(browser, seed, cpuRate, options);
  try {
    if (trace) {
      await mkdir(trace.dir, { recursive: true });
      await session.context.tracing.start({ screenshots: true, snapshots: true });
      await session.cdp.send("Profiler.enable");
      await session.cdp.send("Profiler.start");
    }
    return await run(session);
  } finally {
    if (trace) {
      const { profile } = await session.cdp.send("Profiler.stop");
      await writeFile(join(trace.dir, `${trace.name}.cpuprofile`), JSON.stringify(profile));
      await session.context.tracing.stop({ path: join(trace.dir, `${trace.name}.zip`) });
    }
    await session.context.close();
  }
}

export async function inlineFixtureMark(page: Page) {
  // Route interception disables Chromium's HTTP cache for the measured page, so a
  // remounted fixture image always starts a request even when the response is cacheable.
  // Inline the fixed assets so the warm-request gate measures navigation, not fixture images.
  const directories = ["asset-marks", "currency-flags"] as const;
  const marks = Object.fromEntries((await Promise.all(directories.map(async (directory) => {
    const root = join(__dirname, "../../public", directory);
    return Promise.all((await readdir(root)).filter((name) => name.endsWith(".svg")).map(async (name) => {
      const svg = await readFile(join(root, name));
      return [`/${directory}/${name}`, `data:image/svg+xml;base64,${svg.toString("base64")}`] as const;
    }));
  }))).flat());
  const external = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>').toString("base64")}`;
  await page.addInitScript(({ marks, external }) => {
    const inline = (value: string) => {
      try {
        const url = new URL(value, location.href);
        if (url.hostname === "images.example.test" && url.protocol === "https:") return external;
        if (url.origin === location.origin) return marks[url.pathname] ?? value;
      } catch { /* Leave malformed image URLs unchanged. */ }
      return value;
    };
    const original = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      return original.call(this, name, this instanceof HTMLImageElement && name === "src" ? inline(value) : value);
    };
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...descriptor,
      set(this: HTMLImageElement, value: string) {
        descriptor.set!.call(this, inline(value));
      },
    });
  }, { marks, external });
}

export async function launch() { return chromium.launch({ headless: true, channel: "chromium" }); }

export async function resourceSnapshot(session: Session) {
  await session.cdp.send("HeapProfiler.collectGarbage");
  const entries = (await session.cdp.send("Performance.getMetrics")).metrics;
  const metrics = Object.fromEntries(entries.map(({ name, value }) => [name, value]));
  const metric = (name: string) => {
    const value = metrics[name];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing CDP resource metric ${name}`);
    return value;
  };
  return { nodes: metric("Nodes"), listeners: metric("JSEventListeners"), heapBytes: metric("JSHeapUsedSize") };
}

export async function leakCycle(page: Page, enabled: boolean) {
  if (enabled) await page.evaluate(() => (window as typeof window & { __perfLeakCycle: () => void }).__perfLeakCycle());
}

export async function twoFrames(page: Page, timeoutMs = 5_000) {
  let hostTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([page.evaluate((ms) => {
      let timer: ReturnType<typeof setTimeout>;
      return Promise.race([
        new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
        new Promise<never>((_done, fail) => { timer = setTimeout(() => fail(new Error(`Two animation frames did not arrive within ${ms} ms`)), ms); }),
      ]).finally(() => clearTimeout(timer));
    }, timeoutMs), new Promise<never>((_done, fail) => {
      hostTimer = setTimeout(() => fail(new Error(`Two animation frames did not arrive within ${timeoutMs} ms`)), timeoutMs + 1_000);
    })]);
  } finally { clearTimeout(hostTimer); }
}
