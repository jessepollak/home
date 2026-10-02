import { gzipSync } from "node:zlib";
import { ready } from "./navigation";
import { twoFrames, type Session } from "./browser";
import { type PaintKind } from "./config";
import { observedPaintSample, type PaintSample } from "./evaluate";

async function readPaintMarks(session: Session, path: string, kind: PaintKind) {
  const waitMs = 15_000;
  try {
    await session.page.waitForFunction(() =>
      performance.getEntriesByName("balances:painted", "mark").length > 0 &&
      performance.getEntriesByName("shell:paint", "mark").length > 0, undefined, { timeout: waitMs });
  } catch (error) {
    throw new Error(`${path} ${kind} did not record both paint marks within ${waitMs} ms`, { cause: error });
  }
  const observed = await session.page.evaluate(() => ({
    paintedMs: performance.getEntriesByName("balances:painted", "mark")[0]?.startTime,
    shellMs: performance.getEntriesByName("shell:paint", "mark")[0]?.startTime,
  }));
  return observedPaintSample(observed, path, kind);
}

async function settlePersistedBalances(session: Session, path: string) {
  let previousQueries: string | null = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const queries = await session.page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
      if (!key) return null;
      const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
        clientState?: { queries?: Array<{ queryKey?: unknown[] }> };
      } | null;
      const queries = persisted?.clientState?.queries;
      if (!queries?.some((query) => query.queryKey?.[1] === "balances")) return null;
      return JSON.stringify(queries);
    });
    if (queries !== null && queries === previousQueries) return;
    previousQueries = queries;
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${path} persisted owner balances snapshot did not settle within 10000 ms`);
}

async function measurePersistedPaint(session: Session, path: string) {
  const fixtures = session.fixtures;
  if (!fixtures) throw new Error(`${path} persisted paint requires API fixtures`);
  await settlePersistedBalances(session, path);
  await session.page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("home.query.v1:"));
    if (!key) throw new Error("Persisted owner cache is missing");
    const persisted = JSON.parse(localStorage.getItem(key) ?? "null") as {
      clientState?: { queries?: Array<{ state?: { dataUpdatedAt?: number } }> };
    };
    for (const query of persisted.clientState?.queries ?? []) {
      if (query.state) query.state.dataUpdatedAt = Date.now() - 60_000;
    }
    localStorage.setItem(key, JSON.stringify(persisted));
  });
  void fixtures.delayNextSession();
  void fixtures.delayNextBalances();
  try {
    await session.page.reload({ waitUntil: "domcontentloaded" });
    return await readPaintMarks(session, path, "persisted");
  } finally {
    fixtures.releaseBalances();
    fixtures.releaseSession();
  }
}

export async function measureRoute(session: Session, baseUrl: string, path: string, options?: { startupMarks?: boolean }) {
  const response = await session.page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  if (!response || response.status() !== 200) throw new Error(`Cold ${path} returned ${response?.status() ?? "no response"}`);
  const html = await response.text();
  await ready(session.page, path);
  await session.page.waitForLoadState("networkidle", { timeout: 15_000 });
  await twoFrames(session.page);
  await session.page.evaluate(() => (window as typeof window & { __perfSeedDomNow?: () => void }).__perfSeedDomNow?.());
  const nodes = await session.page.evaluate(() => {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let count = 1;
    while (walker.nextNode()) count++;
    return count;
  });
  const scripts = await session.page.evaluate((documentHtml) => {
    const delivered = new DOMParser().parseFromString(documentHtml, "text/html");
    return [...new Set([...delivered.querySelectorAll<HTMLScriptElement>("script[src]")]
      .map((script) => script.getAttribute("src")!)
      .filter((src) => /^\/_next\/static\/.*\.js(?:\?.*)?$/.test(src)))];
  }, html);
  if (!scripts.length) throw new Error(`No initial JavaScript scripts in ${path} HTML`);
  const bodies = await session.page.evaluate(async (paths) => Promise.all(paths.map(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Initial script ${path} returned ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  })), scripts);
  const initialJs = bodies.reduce((sum, body) => sum + gzipSync(Buffer.from(body), { level: 9 }).length, 0);
  let marks: Record<PaintKind, PaintSample> | undefined;
  if (options?.startupMarks) {
    const cold = await readPaintMarks(session, path, "cold");
    const persisted = await measurePersistedPaint(session, path);
    marks = { cold, persisted };
  }
  return { path, nodes, initialJs, scripts: scripts.length, ...(marks ? { marks } : {}) };
}
