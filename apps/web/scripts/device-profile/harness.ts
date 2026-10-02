import { frameProblem, feedComplete, round, settledPages, waitForQuietFeed, detailPosition, median, percentile, validPlan, visibilityProblem, type Plan, type Run, type Result } from "./model";
import { activityList, activityPartialSources, activityReadinessMarkers, activityRecentRows, activityRowCount, activitySurfaces, activityUnsettledSources, mergePartialSources, visible } from "./activity-rows";

const raf = () => new Promise<number>((done, reject) => {
  const onHidden = () => {
    if (document.visibilityState === "visible") return;
    document.removeEventListener("visibilitychange", onHidden);
    reject(new Error("The measured page was hidden during the measurement; its frames and timers were throttled"));
  };
  document.addEventListener("visibilitychange", onHidden);
  requestAnimationFrame((time) => { document.removeEventListener("visibilitychange", onHidden); done(time); });
});
const twoFrames = async () => { await raf(); return raf(); };
async function until(check: () => boolean, seconds = 40, waiting: string | (() => string) = "expected page state") {
  const deadline = performance.now() + seconds * 1000;
  while (performance.now() < deadline) { if (check()) return; await raf(); }
  throw new Error(`Timed out waiting for ${typeof waiting === "function" ? waiting() : waiting}`);
}
function badge(text: string) {
  let node = document.getElementById("home-device-profile-badge");
  if (!node) { node = document.createElement("div"); node.id = "home-device-profile-badge"; document.body.append(node); }
  node.textContent = text;
  node.style.cssText = "position:fixed;z-index:2147483647;right:8px;top:8px;padding:8px;background:#111;color:white;font:12px system-ui;border-radius:6px;max-width:70vw";
  document.title = text;
}
function main() { const el = document.querySelector<HTMLElement>("main[data-app-main-authenticated]"); if (!el) throw new Error("Missing authenticated main"); return el; }
function blankGap() {
  const root = main();
  const list = activitySurfaces(root).flatMap((surface) => [...surface.querySelectorAll<HTMLElement>("ul")]).filter(visible).at(-1);
  if (!list) return 0;
  const viewport = root.getBoundingClientRect(), bounds = list.getBoundingClientRect();
  const top = Math.max(viewport.top, bounds.top), bottom = Math.min(viewport.bottom, bounds.bottom);
  if (bottom <= top) return 0;
  let covered = top, blank = 0;
  const rects = [...list.querySelectorAll("li")].map((row) => row.getBoundingClientRect()).filter((rect) => rect.bottom > top && rect.top < bottom).sort((a, b) => a.top - b.top);
  for (const rect of rects) { blank = Math.max(blank, rect.top - covered); covered = Math.max(covered, rect.bottom); }
  return Math.max(blank, bottom - covered);
}
async function measure(work: (feedback: number[]) => Promise<void>, periodMs: number, blank = false): Promise<Run> {
  const blocked = visibilityProblem(document.visibilityState);
  if (blocked) throw new Error(blocked);
  const frames: number[] = [], tasks: number[] = [], loafs: number[] = [], blocking: number[] = [], feedback: number[] = [];
  let last = 0, recording = true, hidden = false, samplingError: string | null = null, blankFrames = 0, maxBlankPx = 0;
  let stopOnHidden = () => {};
  const hiddenSignal = new Promise<never>((_resolve, reject) => { stopOnHidden = () => reject(new Error("The measured page was hidden during the measurement; its frames and timers were throttled")); });
  const onVisibility = () => { if (document.visibilityState !== "visible") { hidden = true; stopOnHidden(); } };
  document.addEventListener("visibilitychange", onVisibility);
  const tick = (time: number) => {
    if (!recording) return;
    try {
      if (last) frames.push(time - last);
      last = time;
      if (blank) { const gap = blankGap(); if (gap > 0.5) { blankFrames++; maxBlankPx = Math.max(maxBlankPx, gap); } }
    } catch (error) { samplingError = String(error); recording = false; return; }
    requestAnimationFrame(tick);
  };
  const supported = PerformanceObserver.supportedEntryTypes;
  const observers: PerformanceObserver[] = [];
  for (const [type, values] of [["longtask", tasks], ["long-animation-frame", loafs]] as const) {
    if (!supported.includes(type)) continue;
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) { values.push(entry.duration); if (type === "long-animation-frame") blocking.push((entry as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0); } });
    observer.observe({ type, buffered: false }); observers.push(observer);
  }
  requestAnimationFrame(tick);
  performance.mark("home-device-profile:measure-start");
  try { await Promise.race([work(feedback).then(twoFrames), hiddenSignal]); }
  finally {
    recording = false;
    performance.mark("home-device-profile:measure-end");
    for (const observer of observers) observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  }
  const samples = frames.slice(1);
  if (samplingError) throw new Error(samplingError);
  const throttled = visibilityProblem(document.visibilityState, hidden) ?? frameProblem(samples.length);
  if (throttled) throw new Error(throttled);
  return { frameCount: samples.length, periodMs: round(periodMs), missedDeadlinePct: round(samples.filter((n) => n > 1.5 * periodMs).length / Math.max(1, samples.length) * 100), longFramePct: round(samples.filter((n) => n > 50).length / Math.max(1, samples.length) * 100), longFrameCount: samples.filter((n) => n > 50).length,
    frameMs: { p50: round(percentile(samples, 0.5)), p95: round(percentile(samples, 0.95)), p99: round(percentile(samples, 0.99)), max: round(Math.max(0, ...samples)) }, feedbackMs: feedback.map(round), blankCheck: { framesWithBlank: blankFrames, maxBlankPx: round(maxBlankPx) },
    longTasks: { count: tasks.length, totalMs: round(tasks.reduce((a, b) => a + b, 0)) }, loaf: { count: loafs.length, totalMs: round(loafs.reduce((a, b) => a + b, 0)), blockingMs: round(blocking.reduce((a, b) => a + b, 0)) } };
}
async function calibrate() {
  const blocked = visibilityProblem(document.visibilityState);
  if (blocked) throw new Error(blocked);
  const intervals: number[] = []; let previous = await raf(); const end = performance.now() + 1000;
  while (performance.now() < end) { const time = await raf(); intervals.push(time - previous); previous = time; }
  return median(intervals.filter((n) => n > 0 && n < 100)) || 16.67;
}
async function fill() {
  const root = main();
  await until(() => activitySurfaces(root).some((surface) => surface.querySelectorAll("li").length > 0), 60, () => {
    const pending = activityUnsettledSources(root);
    return pending.length ? `the first activity row to mount (${pending.join(", ")} still loading)` : "the first activity row to mount";
  });
  let listed = -1, settled = 0;
  await until(() => {
    const pending = activityUnsettledSources(root);
    const end = [...document.querySelectorAll<HTMLElement>('[role="status"]')].some((el) => visible(el) && el.textContent?.includes("End of activity"));
    if (!end) {
      root.scrollTop = root.scrollHeight;
      const rendered = activitySurfaces(root).reduce((count, surface) => count + surface.querySelectorAll("li").length, 0);
      settled = settledPages(rendered, listed, settled); listed = rendered;
    }
    return feedComplete({ pending, end, partialSourceCount: activityPartialSources(root).length, settled });
  }, 75, () => {
    const pending = activityUnsettledSources(root);
    return pending.length ? `every activity source to settle (${pending.join(", ")} still loading)` : "the activity feed to reach its end";
  });
  const rowsLoaded = activityRowCount(root), detailRows = activityRecentRows(root), partialSource = activityPartialSources(root);
  partialSource.push(...activityReadinessMarkers(root));
  root.scrollTop = 0;
  await twoFrames();
  return { rowsLoaded, detailRows, partialSource };
}
async function sourcePartials(filled: { rowsLoaded: number; partialSource: string[] }, pending: string[]) {
  const observed = await waitForQuietFeed({
    rows: filled.rowsLoaded,
    pending,
    frame: raf,
    sample: () => ({ rows: activityRowCount(main()), pending: activityUnsettledSources(main()), markers: activityReadinessMarkers(main()) }),
  });
  return mergePartialSources(filled.partialSource, [...activityPartialSources(main()), ...observed]);
}
async function fling() {
  const root = main();
  for (const destination of [root.scrollHeight - root.clientHeight, 0]) {
    const start = root.scrollTop, at = performance.now();
    while (true) {
      const t = await raf();
      root.scrollTop = start + Math.sign(destination - start) * Math.min(Math.abs(destination - start), (t - at) * 4);
      const edge = destination > start ? Math.max(0, root.scrollHeight - root.clientHeight) : 0;
      if (Math.abs(root.scrollTop - destination) <= 5 || Math.abs(root.scrollTop - edge) <= 5) break;
      if (t - at > 30000) throw new Error("Scroll did not reach destination");
    }
  }
}
async function interaction(target: HTMLElement, condition: () => boolean, feedback: number[]) {
  const started = performance.now(); target.click(); await until(condition); const at = await twoFrames(); feedback.push(at - started);
}
function button(name: string) {
  const candidates = [...document.querySelectorAll<HTMLElement>('button,a,[role="button"]')];
  const found = candidates.find((el) => visible(el) && [el.getAttribute("aria-label"), el.getAttribute("aria-description"), el.textContent?.trim()].some((value) => value?.toLowerCase() === name.toLowerCase() || value?.trim().toLowerCase().endsWith(name.toLowerCase())));
  if (!found) throw new Error(`Missing ${name} control`);
  return found;
}
function nav(name: string) {
  const el = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Main navigation"] button')].find((node) => visible(node) && node.textContent?.trim() === name);
  if (!el) throw new Error(`Missing ${name} navigation`);
  return el;
}
const pageContentSelector: Record<string, string> = {
  "/home": "[data-money-summary]",
  "/cash": "#cash-panel",
  "/invest": "h1, h2",
};
function atPanel(path: string) {
  if (location.pathname !== path) return false;
  const panel = document.querySelector<HTMLElement>("#navigation-panel");
  if (!visible(panel)) return false;
  const content = pageContentSelector[path];
  return content === undefined || visible(panel.querySelector<HTMLElement>(content));
}
async function roundTrip(feedback: number[]) {
  await interaction(button("Open Cash"), () => atPanel("/cash"), feedback);
  await interaction(nav("Home"), () => atPanel("/home"), feedback);
  await interaction(nav("Invest"), () => atPanel("/invest"), feedback);
  const at = performance.now(); history.back(); await until(() => atPanel("/home")); feedback.push((await twoFrames()) - at);
}
async function detail(feedback: number[], rows: number) {
  const root = main(), position = detailPosition(rows);
  const list = activityList(root);
  if (!list) throw new Error("Missing activity detail list control");
  root.scrollTop += list.getBoundingClientRect().top - root.getBoundingClientRect().top + list.scrollHeight * position / rows - root.clientHeight / 2;
  await until(() => {
    const item = list?.querySelector<HTMLElement>(`li[aria-posinset="${position}"]`);
    if (visible(item ?? null)) return true;
    const nearest = [...(list?.querySelectorAll<HTMLElement>('li[aria-posinset]') ?? [])].reduce((best, item) => Math.abs(Number(item.getAttribute("aria-posinset")) - position) < Math.abs(best - position) ? Number(item.getAttribute("aria-posinset")) : best, 0);
    root.scrollTop += (position - nearest) * 76;
    return false;
  }, 15);
  for (let i = 0; i < 3; i++) {
    const opener = list?.querySelector<HTMLElement>(`li[aria-posinset="${position}"] button:not([aria-expanded])`);
    if (!visible(opener)) throw new Error(`Missing activity detail control for row ${position} (absent or a grouped run)`);
    await interaction(opener, () => visible(document.querySelector('[role="dialog"]')), feedback);
    const close = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((node) => visible(node) && (node.getAttribute("aria-label") ?? "").startsWith("Close "));
    if (!close) throw new Error("Missing activity detail Close control");
    close.click();
    await until(() => !visible(document.querySelector('[role="dialog"]')));
  }
}
async function chart(feedback: number[]) {
  await until(() => visible(document.querySelector('[aria-roledescription="chart"]')) || [...document.querySelectorAll<HTMLElement>('[aria-label="Market price history"] [role="status"]')].some((node) => visible(node) && node.getAttribute("aria-label") !== "Loading price history"));
  const chart = [...document.querySelectorAll<HTMLElement>('[aria-roledescription="chart"]')].find(visible);
  if (!chart) throw new Error(`Missing asset price chart control: ${document.querySelector('[aria-label="Market price history"] [role="status"]')?.getAttribute("aria-label") ?? "no chart data"}`);
  const rect = chart.getBoundingClientRect(), marker = chart.querySelector<HTMLElement>("[data-scrub-cursor]");
  if (!marker) throw new Error("Missing chart scrub cursor control");
  const readout = () => {
    const time = document.querySelector<HTMLElement>("[data-scrub-readout]")?.textContent?.trim();
    return time ? `${time}|${chart.closest("section")?.parentElement?.querySelector("strong")?.textContent?.trim() ?? ""}` : "";
  };
  const start = performance.now(); let last = marker.style.insetInlineStart, moved = 0;
  chart.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: rect.left + rect.width * 0.08, clientY: rect.top + rect.height / 2 }));
  while (performance.now() - start < 1500) {
    const time = await raf(), fraction = (time - start) / 1500, x = rect.left + rect.width * (fraction < 0.5 ? 0.08 + fraction * 1.68 : 0.92 - (fraction - 0.5) * 1.68);
    const previous = readout();
    const before = performance.now(); chart.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: x, clientY: rect.top + rect.height / 2 }));
    const painted = await twoFrames();
    if (marker.style.insetInlineStart !== last && marker.style.opacity === "1") {
      last = marker.style.insetInlineStart; moved++;
      if (readout() && readout() !== previous) feedback.push(painted - before);
    }
  }
  chart.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch", clientX: rect.right - 20, clientY: rect.top + rect.height / 2 }));
  if (!moved) throw new Error("Chart scrub cursor did not move");
}
function wrapReplace() {
  const original = history.replaceState;
  const times: number[] = [], errors: { name: string; message: string }[] = [];
  history.replaceState = function (...args) {
    times.push(performance.now());
    try { return original.apply(this, args); } catch (error) { const e = error as Error; errors.push({ name: e.name, message: e.message }); throw error; }
  };
  return { finish() {
    history.replaceState = original;
    let max = 0;
    for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! > 10000) j++; max = Math.max(max, i - j + 1); }
    return { calls: times.length, maxCalls10s: max, errors, securityError: errors.some((e) => e.name === "SecurityError") };
  } };
}
async function probe(period: number) {
  const phases: Run["replaceState"] = [], traces: Run[] = [];
  const filled = await fill();
  for (const extra of [false, true]) {
    const root = main();
    const wrapped = wrapReplace();
    const listener = () => { try { history.replaceState(history.state, ""); } catch {} };
    if (extra) root.addEventListener("scroll", listener);
    try { traces.push(await measure(fling, period, true)); }
    finally { try { if (extra) root.removeEventListener("scroll", listener); } finally { phases.push(wrapped.finish()); } }
  }
  const pending = activityUnsettledSources(main());
  const wrapped = wrapReplace();
  try { for (let i = 0; i < 200; i++) { try { history.replaceState(history.state, ""); } catch {} } }
  finally { phases.push(wrapped.finish()); }
  const result = traces[1]!; result.replaceState = phases; result.scrollDriver = "js"; result.rowsLoaded = filled.rowsLoaded; const partialSource = await sourcePartials(filled, pending); if (partialSource.length) result.partialSource = partialSource; return result;
}
async function run(plan: Plan, period: number): Promise<Run> {
  if (plan.workload === "replace-state-probe") return probe(period);
  if (plan.workload === "home-fling" || plan.workload === "activity-fling") {
    const filled = await fill();
    const run = await measure(fling, period, true);
    const pending = activityUnsettledSources(main());
    run.scrollDriver = "js"; run.rowsLoaded = filled.rowsLoaded;
    const partialSource = await sourcePartials(filled, pending);
    if (partialSource.length) run.partialSource = partialSource;
    return run;
  }
  if (plan.workload === "nav-round-trips") {
    await until(() => { try { return !!button("Open Cash"); } catch { return false; } });
    await roundTrip([]);
    return measure(async (feedback) => { for (let i = 0; i < 10; i++) await roundTrip(feedback); }, period);
  }
  if (plan.workload === "add-money-open") return measure(async (feedback) => {
    for (let i = 0; i < 3; i++) {
      await interaction(button("Add money"), () => visible(document.querySelector('[role="dialog"]')), feedback);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await until(() => !visible(document.querySelector('[role="dialog"]')));
    }
  }, period);
  if (plan.workload === "activity-detail-open") {
    const filled = await fill();
    const run = await measure((feedback) => detail(feedback, filled.detailRows), period, true);
    const pending = activityUnsettledSources(main());
    run.rowsLoaded = filled.rowsLoaded;
    const partialSource = await sourcePartials(filled, pending);
    if (partialSource.length) run.partialSource = partialSource;
    return run;
  }
  if (plan.workload === "chart-scrub") { const result = await measure(chart, period); return Object.assign(result, { feedback: result.feedbackMs.length ? "readout" : "none" }); }
  badge("Profile recording in 3…");
  await new Promise<void>((done) => setTimeout(done, 3000));
  badge("Profile recording");
  return measure(async () => { await new Promise<void>((done) => setTimeout(done, plan.duration * 1000)); }, period, true);
}
async function execute() {
  const raw = sessionStorage.getItem("home:device-profile:plan");
  if (!raw) return;
  let plan: Plan;
  try { const parsed: unknown = JSON.parse(raw); if (!validPlan(parsed)) throw new Error("Invalid plan"); plan = parsed; }
  catch { sessionStorage.removeItem("home:device-profile:plan"); badge("Profile failed: invalid plan"); return; }
  sessionStorage.removeItem("home:device-profile:plan");
  const result: Result = { version: 1, plan, environment: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, standalone: matchMedia("(display-mode: standalone)").matches, navigatorStandalone: !!(navigator as Navigator & { standalone?: boolean }).standalone, supportedEntryTypes: PerformanceObserver.supportedEntryTypes, ...location.protocol === "http:" ? { fixture: { tokenImages: "omitted" as const } } : {} }, runs: [] };
  try {
    await until(() => !!document.querySelector("main[data-app-main-authenticated]"), 40, "the authenticated shell");
    for (let i = 0; i < plan.repeat; i++) { badge(`Profiling ${plan.workload} ${i + 1}/${plan.repeat}`); const blocked = visibilityProblem(document.visibilityState); if (blocked) throw new Error(blocked); result.runs.push(await run(plan, await calibrate())); }
    badge("Profile complete");
  } catch (error) { result.error = String(error); badge(`Profile failed: ${result.error}`); }
  let posted = false;
  const fixture = location.protocol === "http:" && location.pathname !== "/__device-profile/run";
  if (fixture) {
    try { const response = await fetch("/__device-profile/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }); posted = response.ok; } catch {}
  }
  if (!posted) console.log(`HOME_DEVICE_PROFILE_RESULT ${JSON.stringify(result)}`);
  if (fixture && !posted && !result.error) badge("Profile result was not saved; the console has it");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void execute(), { once: true });
else void execute();
