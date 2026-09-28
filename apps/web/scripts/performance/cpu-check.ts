import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inlineFixtureMark, launch, twoFrames, withSession } from "./browser";
import { fillFeed, installFeed } from "./feed";
import { home, navigate, ready } from "./navigation";

type Sample = { requested: number; applied: number; scriptMs: number; longFrames: number };

async function main() {
  const started = Date.now();
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--base-url" || args[2] !== "--out-dir")
    throw new Error("Usage: perf:cpu-check --base-url http://localhost:3199 --out-dir <dir>");
  const url = new URL(args[1]!);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/" || url.search || url.hash)
    throw new Error("A local HTTP fixture server is required");
  const dir = resolve(args[3]!);
  await mkdir(dir, { recursive: true });
  const browser = await launch();
  const samples: Sample[] = [];
  const windows: number[] = [];
  try {
    for (const rate of [4, 1]) {
      await withSession(browser, null, async (session) => {
        const { page, cdp } = session;
        await page.clock.install({ time: new Date() });
        await inlineFixtureMark(page);
        const fixture = await installFeed(page, 300);
        await page.goto(`${url.origin}/home`, { waitUntil: "domcontentloaded" });
        await ready(page, "/home");
        await fillFeed(session, 300, fixture.filled, "section[data-activity-feed]");
        fixture.verify();
        await page.locator("main[data-app-main-authenticated]").evaluate((main) => { main.scrollTop = 0; });
        await twoFrames(page);
        await navigate(page, "/cash");
        await home(page);
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
        await page.clock.setFixedTime(new Date());
        await page.evaluate(() => {
          const state = window as typeof window & { __cpuCheck?: { frames: number; observer: PerformanceObserver } };
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) if (entry.duration >= 50) state.__cpuCheck!.frames++;
          });
          if (!PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")) throw new Error("Long animation frames are unavailable");
          observer.observe({ type: "long-animation-frame", buffered: false });
          state.__cpuCheck = { frames: 0, observer };
        });
        const scriptDuration = async () => {
          const metric = (await cdp.send("Performance.getMetrics")).metrics.find(({ name }) => name === "ScriptDuration")?.value;
          if (typeof metric !== "number" || !Number.isFinite(metric)) throw new Error("Missing CDP ScriptDuration metric");
          return metric;
        };
        const windowStarted = Date.now();
        for (let i = 0; i < 20; i++) {
          const before = await scriptDuration();
          const framesBefore = await page.evaluate(() => (window as typeof window & { __cpuCheck: { frames: number } }).__cpuCheck.frames);
          await navigate(page, i % 2 === 0 ? "/cash" : "/invest");
          await home(page);
          await twoFrames(page);
          const after = await scriptDuration();
          const framesAfter = await page.evaluate(() => (window as typeof window & { __cpuCheck: { frames: number } }).__cpuCheck.frames);
          samples.push({ ...session.cpu, scriptMs: Math.round((after - before) * 100_000) / 100, longFrames: framesAfter - framesBefore });
        }
        await page.evaluate(() => (window as typeof window & { __cpuCheck: { observer: PerformanceObserver } }).__cpuCheck.observer.disconnect());
        const windowMs = Date.now() - windowStarted;
        if (windowMs >= 55_000) throw new Error(`CPU check measured window exceeded 55 s (${windowMs} ms at ${rate}×)`);
        windows.push(windowMs);
      }, undefined, rate);
    }
  } finally { await browser.close(); }
  const totals = (rate: number) => {
    const rows = samples.filter((sample) => sample.requested === rate);
    return { requested: rate, applied: [...new Set(rows.map((row) => row.applied))],
      scriptMs: Math.round(rows.reduce((total, row) => total + row.scriptMs, 0) * 100) / 100,
      longFrames: rows.reduce((total, row) => total + row.longFrames, 0), samples: rows.length };
  };
  const slow = totals(4), fast = totals(1);
  const checks = {
    applied: samples.length === 40 && samples.every(({ requested, applied }) => requested === applied),
    signal: slow.longFrames >= 1,
    script: fast.scriptMs <= 0.6 * slow.scriptMs,
    longFrames: fast.longFrames < slow.longFrames,
  };
  const pass = Object.values(checks).every(Boolean);
  await writeFile(join(dir, "cpu-check.json"), JSON.stringify({ version: 1, samples, totals: [slow, fast], checks, pass }, null, 2) + "\n");
  await writeFile(join(dir, "cpu-check.md"), ["# CPU throttle self-check", "", "| Requested | Applied | Script ms | Long frames | Samples |", "|---:|---:|---:|---:|---:|",
    ...[slow, fast].map((row) => `| ${row.requested}× | ${row.applied.map((rate) => `${rate}×`).join(", ")} | ${row.scriptMs} | ${row.longFrames} | ${row.samples} |`),
    "", `Applied: ${checks.applied ? "pass" : "FAIL"} · Signal (4× has long frames): ${checks.signal ? "pass" : "FAIL"} · Script: ${checks.script ? "pass" : "FAIL"} · Long frames: ${checks.longFrames ? "pass" : "FAIL"}`, ""].join("\n"));
  console.log(`CPU throttle self-check: ${pass ? "pass" : "FAIL"}; 4× ${slow.scriptMs} ms / ${slow.longFrames} frames, 1× ${fast.scriptMs} ms / ${fast.longFrames} frames; windows ${windows.map((ms) => `${(ms / 1000).toFixed(2)}s`).join(" / ")}; runtime ${((Date.now() - started) / 1000).toFixed(2)}s`);
  if (!pass) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error("CPU throttle harness error:", error); process.exitCode = 2; });
