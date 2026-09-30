import { gzipSync } from "node:zlib";
import { ready } from "./navigation";
import { twoFrames, type Session } from "./browser";

export async function measureRoute(session: Session, baseUrl: string, path: string) {
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
  return { path, nodes, initialJs, scripts: scripts.length };
}
