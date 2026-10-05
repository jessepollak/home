import { afterEach, test, expect, setSystemTime } from "bun:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { activityPage, fixtureSyntheticActivity, syntheticActivity } from "./synthetic-activity";
import { parseHistoryResponse, MARKET_PRICE_RANGES } from "../../shared/invest/contracts/market-price-history";
import { parseSession } from "../../shared/account/contracts/session";
import { isVerifiedActivitySession, parseActivityPage } from "../../shared/activity/contract";
import { sessionBody } from "../../tests/browser/fixtures/bodies";
import { FIXED_NOW } from "../../tests/browser/fixtures/fixed-time";
import { assertOutsideWorktree, cookieRows, createHandler, fixtureBody, injectHtml, matches, parsePlan, probeProxy, proxyOptions, toolkitFingerprint } from "./proxy";
import { acquireDeviceLock } from "./device-lock";
import { artifactName, assertProxyToolkit, CHROME_COMMAND_LINE, chromeCommandLineArgs, chromeCommandLineSnapshot, debugAppFrom, detailPosition, detailTarget, duplicateValues, feedChangeMarker, feedComplete, frameProblem, isEmulatorDevice, loadedRowCount, matrix, median, parseAdbDevices, parseArgs, partialFeedComplete, percentile, phoneFamily, phoneView, probeInto, productionTarget, resultFailure, routeFor, runId, runPartial, safeName, selectSimulator, settledPages, simulatorRuntimeVersion, simulatorView, summarize, traceTotals, unsettledMarker, validResult, visibilityProblem, waitForQuietFeed, androidFamily, androidView, type Result, type Run, type TraceEvent } from "./model";

const pendingCleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const release of pendingCleanup.splice(0).reverse()) await release(); });

const runFor = (overrides: Partial<Run> = {}): Run => ({
  frameCount: 60, periodMs: 16.67, missedDeadlinePct: 0, longFramePct: 0, longFrameCount: 0,
  frameMs: { p50: 16, p95: 17, p99: 20, max: 30 }, feedbackMs: [], blankCheck: { framesWithBlank: 0, maxBlankPx: 0 },
  longTasks: { count: 0, totalMs: 0 }, loaf: { count: 0, totalMs: 0, blockingMs: 0 }, ...overrides,
});
const resultFor = (runs: Result["runs"], overrides: Partial<Result> = {}): Result => ({
  version: 1,
  plan: { workload: "activity-fling", rows: 300, label: "test", repeat: Math.max(1, runs.length), duration: 10 },
  environment: { userAgent: "Chrome", viewport: { width: 390, height: 844 }, dpr: 3, standalone: false, navigatorStandalone: false, supportedEntryTypes: [] },
  runs,
  ...overrides,
});

test("synthetic generator keeps 25-transfer pagination and original deterministic row values", () => {
  const anchor = Date.parse("2026-09-01T12:00:00Z"), data = syntheticActivity(300, anchor);
  expect(data.transfers).toHaveLength(270);
  expect(data.actions).toHaveLength(30);
  expect(data.transfers[13]?.tokenImageUrl).toBe("https://profile.local/token.svg");
  expect(data.actions[0]?.status).toBe("pending");
  const to = new Date(anchor + 120000).toISOString();
  const first = activityPage(data, "initial", to), second = activityPage(data, "page-1", to);
  expect(first.transfers).toHaveLength(25);
  expect(second.transfers[0]?.id).toBe(data.transfers[25]?.id);
  expect(first.nextCursor).toBe("page-1");
  expect(() => activityPage(data, "page-99", to)).toThrow("Unexpected cursor");
});

test.each([-86_400_000 * 40, 0, 86_400_000 * 40])("fixture synthetic activity parses every page in the pinned clock window when the host clock is offset by %pms", (offset) => {
  setSystemTime(new Date(FIXED_NOW + offset));
  let data: ReturnType<typeof syntheticActivity>;
  try { data = fixtureSyntheticActivity(300); } finally { setSystemTime(); }
  const to = new Date(FIXED_NOW).toISOString();
  const session = parseSession(sessionBody);
  expect(isVerifiedActivitySession(session)).toBe(true);
  if (!isVerifiedActivitySession(session)) throw new Error("Expected a verified fixture session");
  const transferIds: string[] = [];
  let cursor: string | null = "initial";
  while (cursor !== null) {
    const body = activityPage(data, cursor, to);
    const page = parseActivityPage(body, session, to);
    transferIds.push(...page.transfers.map((transfer) => transfer.id));
    cursor = page.nextCursor;
  }
  expect(transferIds).toHaveLength(270);
  expect(transferIds).toEqual(data.transfers.map((transfer) => transfer.id));
});

test("fixture glob routing distinguishes exact path and query and preserves ordered overrides", () => {
  expect(matches("**/api/actions", "http://localhost:4199/api/actions?x=1")).toBe(false);
  expect(matches("**/api/balances**", "http://localhost:4199/api/balances?region=US")).toBe(true);
  const url = (path: string) => new URL(`http://localhost:4199${path}`);
  expect((fixtureBody(url("/api/activity/orders"), 20, 100000) as { orders: readonly unknown[] }).orders).toEqual([]);
  const second = fixtureBody(url("/api/activity?cursor=page-1"), 100, 100000) as { transfers: { tokenImageUrl: string | null }[] };
  expect(second.transfers).toHaveLength(25);
  expect(second.transfers.every((transfer) => transfer.tokenImageUrl === null)).toBe(true);
  expect((fixtureBody(url("/api/actions"), 20, 100000) as { actions: unknown[] }).actions).toHaveLength(2);
  expect(fixtureBody(url("/api/unmatched"), 20, 100000)).toBeUndefined();
});

test("proxy serves deterministic synthetic history accepted by the client parser for every range and asset", async () => {
  const anchor = Date.parse("2026-09-01T12:00:00Z");
  const handler = createHandler({ port: 4199, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: tmpdir() }, "harness", "toolkit", () => anchor + 120_000);
  for (const assetId of ["cbbtc", "cbxrp", "nvdac", "base:0x1111111111111111111111111111111111111111"]) {
    for (const range of MARKET_PRICE_RANGES) {
      const url = `http://localhost/api/market-prices/history?${new URLSearchParams({ assetId, range })}`;
      const response = await handler(new Request(url));
      expect(response.status).toBe(200);
      const history = parseHistoryResponse(await response.json());
      expect(history).not.toBeNull();
      expect(String(history?.assetId)).toBe(assetId);
      expect(history?.range).toBe(range);
      expect(history?.status).toBe("ready");
      expect(history?.points).toHaveLength(assetId === "nvdac" ? 32 : 241);
      expect(Date.parse(history!.points.at(-1)!.time)).toBe(anchor + 120_000);
      expect(new Set(history!.points.map((point) => point.value)).size).toBeGreaterThan(assetId === "nvdac" ? 20 : 100);
      expect(fixtureBody(new URL(url), 300, anchor)).toEqual(history);
    }
  }
});

test("HTML injection is first in head and rows cookie and run plan validate bounds", () => {
  const html = injectHtml("<html><HEAD data-x><title>App</title></HEAD><body>x</body></html>");
  expect(html).toContain('<head data-x><script>sessionStorage.setItem');
  expect(html.indexOf("harness.js")).toBeLessThan(html.indexOf("<title>"));
  expect(cookieRows("other=1; home-device-profile-rows=170; x=2", 300)).toBe(170);
  expect(cookieRows("home-device-profile-rows=2001", 300)).toBe(300);
  expect(parsePlan(new URL("http://localhost/__device-profile/run?workload=home-fling&rows=20"), 300)?.rows).toBe(20);
  expect(parsePlan(new URL("http://localhost/__device-profile/run?workload=home-fling&rows=0"), 300)).toBeNull();
});

test("proxy validates writes, sanitizes filename, caps body and refuses repository output", async () => {
  const dir = join(tmpdir(), `home-profile-test-${crypto.randomUUID()}`);
  try {
    await expect(assertOutsideWorktree(resolve(import.meta.dir))).rejects.toThrow("outside");
    await assertOutsideWorktree(dir);
    expect(() => proxyOptions(new Map([["upstream", "https://example.com"]]))).toThrow("loopback");
    const handler = createHandler({ port: 4199, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: dir }, "harness", "toolkit", () => 123456);
    const run = await handler(new Request("http://localhost/__device-profile/run?workload=home-fling&rows=20&label=test"));
    expect(run.headers.get("set-cookie")).toContain("home-device-profile-rows=20");
    const body = await run.text();
    expect(body).toContain("/home");
    const hostile = await (await handler(new Request(`http://localhost/__device-profile/run?workload=home-fling&rows=20&label=${encodeURIComponent("</script><script>alert(1)</script>")}`))).text();
    expect(hostile.match(/<\/script>/gi)).toHaveLength(1);
    expect(hostile).toContain("\\u003c/script>");
    const result: Result = { version: 1, plan: { workload: "home-fling", rows: 20, repeat: 1, label: "../../outside", duration: 10 }, environment: { userAgent: "Safari", viewport: { width: 390, height: 844 }, dpr: 3, standalone: false, navigatorStandalone: false, supportedEntryTypes: [] }, runs: [] };
    const response = await handler(new Request("http://localhost/__device-profile/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }));
    expect(response.status).toBe(200);
    const { filename } = await response.json() as { filename: string };
    expect(filename).toBe("123456-______outside-home-fling.json");
    const status = await handler(new Request("http://localhost/__device-profile/status?since=123455"), "127.0.0.1").then((response) => response.json()) as { outDir: string; files: string[] };
    expect(status.files).toContain(filename);
    expect(status.outDir).toBe(dir);
    await Bun.write(join(dir, `${filename}.stale.writing`), "{}");
    const listed = await handler(new Request("http://localhost/__device-profile/status?since=123455")).then((response) => response.json()) as { files: string[] };
    expect(listed.files).toEqual([filename]);
    expect((await handler(new Request("http://localhost/__device-profile/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }))).status).toBe(500);
    expect((await handler(new Request("http://localhost/__device-profile/status?since=123455")).then((response) => response.json()) as { files: string[] }).files).toEqual([filename]);
    expect((await handler(new Request("http://localhost/__device-profile/status?since=123455"))).status).toBe(200);
    expect((await handler(new Request("http://localhost/__device-profile/results", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }))).status).toBe(415);
    expect((await handler(new Request("http://localhost/__device-profile/results", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(2_000_001) }))).status).toBe(413);
    let pulled = 0;
    const streamed = new ReadableStream<Uint8Array>({ pull(controller) { pulled++; if (pulled <= 8) controller.enqueue(new TextEncoder().encode("y".repeat(300_000))); else controller.close(); } });
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: streamed } as RequestInit;
    expect((await handler(new Request("http://localhost/__device-profile/results", { ...init, duplex: "half" } as RequestInit))).status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(8);
  } finally {
    const process = Bun.spawn(["rm", "-r", "--", dir]);
    await process.exited;
  }
});

test("proxy reuse requires the current toolkit", () => {
  const toolkit = "a".repeat(64);
  expect(() => assertProxyToolkit({ toolkit, files: [] }, toolkit, 4199)).not.toThrow();
  const mismatch = "The device-profile proxy on port 4299 was started from a different checkout or build; stop the proxy you started there, or pass --port";
  for (const status of [{ toolkit: "b".repeat(64) }, { files: [] }, { toolkit: null }]) expect(() => assertProxyToolkit(status, toolkit, 4299)).toThrow(mismatch);
  for (const status of [null, undefined, [], "not JSON", 200]) expect(() => assertProxyToolkit(status, toolkit, 4299)).toThrow("The service on port 4299 isn't a current device-profile proxy");
});

function listeningPort(port: number | undefined): number {
  expect(port).toBeDefined();
  if (port === undefined) throw new Error("Expected a listening server port");
  return port;
}

test("proxy probe reuses a matching toolkit", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ toolkit: "current", files: [] }) });
  try {
    expect(await probeProxy(listeningPort(server.port), "current", 200)).toBe("reuse");
  } finally { await server.stop(true); }
});

test("proxy probe rejects a mismatched toolkit", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ toolkit: "other", files: [] }) });
  try {
    await expect(probeProxy(listeningPort(server.port), "current", 200)).rejects.toThrow("different checkout or build");
  } finally { await server.stop(true); }
});

test("proxy probe rejects a non-JSON successful response", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("not JSON") });
  try {
    await expect(probeProxy(listeningPort(server.port), "current", 200)).rejects.toThrow("isn't a current device-profile proxy");
  } finally { await server.stop(true); }
});

test("proxy probe treats an unavailable service as absent", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unavailable", { status: 503 }) });
  try {
    expect(await probeProxy(listeningPort(server.port), "current", 200)).toBe("absent");
  } finally { await server.stop(true); }
});

test("proxy probe treats a closed port as absent", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  try {
    const port = listeningPort(server.port);
    await server.stop(true);
    expect(await probeProxy(port, "current", 200)).toBe("absent");
  } finally { await server.stop(true); }
});

test("proxy probe reports a stalled successful body as a read failure, not a non-proxy", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"toolkit":')); },
    })),
  });
  try {
    const error = await probeProxy(listeningPort(server.port), "current", 200).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(`Reading the device-profile proxy status on port ${server.port} failed:`);
    expect(String(error)).not.toContain("isn't a current device-profile proxy");
  } finally { await server.stop(true); }
});

test("toolkit fingerprint is a deterministic sha256 of the toolkit sources", async () => {
  const script = `import { buildToolkit } from ${JSON.stringify(resolve(import.meta.dir, "proxy.ts"))}; console.log(JSON.stringify([await buildToolkit(), await buildToolkit()]));`;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  const builds: unknown = JSON.parse(stdout);
  if (!Array.isArray(builds)) throw new Error("Expected an array of toolkit builds");
  const [first, second]: unknown[] = builds;
  if (typeof first !== "object" || first === null || !("harness" in first) || !("toolkit" in first)) throw new Error("Expected a toolkit build");
  if (typeof first.harness !== "string" || typeof first.toolkit !== "string") throw new Error("Expected string harness and toolkit fields");
  expect(first.harness.length).toBeGreaterThan(0);
  expect(first.toolkit).toMatch(/^[a-f0-9]{64}$/);
  if (typeof second !== "object" || second === null || !("toolkit" in second)) throw new Error("Expected a second toolkit build");
  expect(second.toolkit).toBe(first.toolkit);
});

test("toolkit fingerprint ignores minification and changes with dependency sources", async () => {
  const dir = join(tmpdir(), `home-profile-fingerprint-${crypto.randomUUID()}`);
  try {
    const entry = join(dir, "entry.ts"), dependency = join(dir, "dep.ts");
    await Bun.write(entry, 'import { value } from "./dep.ts"; console.log(value);');
    await Bun.write(dependency, 'export const value = "first";');
    const minified = await Bun.build({ entrypoints: [entry], target: "bun", minify: true, metafile: true });
    const plain = await Bun.build({ entrypoints: [entry], target: "bun", minify: false, metafile: true });
    expect(minified.success).toBe(true);
    expect(plain.success).toBe(true);
    if (!minified.metafile || !plain.metafile) throw new Error("Expected toolkit build metadata");
    const fingerprint = await toolkitFingerprint([minified.metafile]);
    expect(await toolkitFingerprint([plain.metafile])).toBe(fingerprint);
    await Bun.write(dependency, 'export const value = "changed";');
    const changed = await Bun.build({ entrypoints: [entry], target: "bun", metafile: true });
    expect(changed.success).toBe(true);
    if (!changed.metafile) throw new Error("Expected changed toolkit build metadata");
    expect(await toolkitFingerprint([changed.metafile])).not.toBe(fingerprint);
  } finally {
    await Bun.spawn(["rm", "-rf", "--", dir]).exited;
  }
});

test("a proxy started by an earlier process is reused by a fresh toolkit build", async () => {
  const dir = join(tmpdir(), `home-profile-reuse-${crypto.randomUUID()}`);
  pendingCleanup.push(async () => { await Bun.spawn(["rm", "-rf", "--", dir]).exited; });
  const proxyPath = JSON.stringify(resolve(import.meta.dir, "proxy.ts"));
  const child = Bun.spawn([process.execPath, "-e", `import { startProxy } from ${proxyPath}; const server = await startProxy({ port: 0, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: ${JSON.stringify(join(dir, "results"))} }); console.log("port " + server.port);`], { stdout: "pipe", stderr: "pipe" });
  pendingCleanup.push(async () => { child.kill(); await child.exited; });
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  let output = "", port: number | undefined;
  while (port === undefined) {
    const { value, done } = await Promise.race([reader.read(), child.exited.then(() => ({ value: undefined, done: true }))]);
    if (done) throw new Error(`Proxy child exited before listening: ${await new Response(child.stderr).text()}`);
    output += decoder.decode(value, { stream: true });
    const match = output.match(/port (\d+)/);
    if (match) port = Number(match[1]);
  }
  const script = `import { buildToolkit, probeProxy } from ${proxyPath}; const built = await buildToolkit(); console.log(await probeProxy(${port}, built.toolkit, 5000));`;
  const probe = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  pendingCleanup.push(async () => { probe.kill(); await probe.exited; });
  const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
  expect(stdout.trim()).toBe("reuse");
  expect(stderr).toBe("");
  expect(code).toBe(0);
}, 20_000);

test("status reports the toolkit to every client and the output directory only to loopback", async () => {
  const dir = join(tmpdir(), `home-profile-status-${crypto.randomUUID()}`);
  try {
    await assertOutsideWorktree(dir);
    const handler = createHandler({ port: 4199, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: dir }, "harness", "toolkit", () => 99);
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(await handler(new Request("http://localhost/__device-profile/status"), address).then((response) => response.json())).toEqual({ toolkit: "toolkit", outDir: dir, files: [] });
    }
    for (const address of ["192.168.1.20", "::ffff:192.168.1.20", "", null]) {
      const lan = await handler(new Request("http://localhost/__device-profile/status"), address).then((response) => response.json());
      expect(lan).toEqual({ toolkit: "toolkit", files: [] });
      expect(JSON.stringify(lan)).not.toContain(dir);
    }
  } finally {
    const process = Bun.spawn(["rm", "-r", "--", dir]);
    await process.exited;
  }
});


test("a proxy failure answers with a generic error instead of a rendered stack", async () => {
  const path = join(tmpdir(), `home-profile-failure-${crypto.randomUUID()}`);
  try {
    await Bun.write(path, "not a directory");
    const handler = createHandler({ port: 4199, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: path }, "harness", "toolkit", () => 1);
    const response = await handler(new Request("http://localhost/__device-profile/status"), "192.168.1.20");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ error: "Device profile proxy failed" }));
  } finally {
    const process = Bun.spawn(["rm", "-f", "--", path]);
    await process.exited;
  }
});

test("restoring Chrome's command-line file is a quoted shell write or a removal, never unencoded text", () => {
  expect(chromeCommandLineArgs(null)).toEqual(["shell", "rm", "-f", "/data/local/tmp/chrome-command-line"]);
  const escaped = `${"$()"} ${CHROME_COMMAND_LINE} $(touch /tmp/escape) 'quoted'`;
  const encoded = Buffer.from(escaped).toString("base64");
  const args = chromeCommandLineArgs(encoded);
  expect(args[0]).toBe("shell");
  expect(args[1]).toBe("sh");
  expect(args[3]).toBe(`'echo ${encoded} | base64 -d > /data/local/tmp/chrome-command-line'`);
  expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  expect(Buffer.from(encoded, "base64").toString()).toBe(escaped);
});

test("debug app parsing refuses a dumpsys without a readable designation", () => {
  expect(debugAppFrom("  mDebugApp=com.android.settings/orig=null mDebugTransient=false")).toBe("com.android.settings");
  expect(debugAppFrom("  mDebugApp=null/orig=com.android.chrome mDebugTransient=false")).toBeNull();
  expect(() => debugAppFrom("no activity state here")).toThrow("refusing to change it");
  expect(() => debugAppFrom("  mDebugApp=/orig=null mDebugTransient=false")).toThrow("refusing to change it");
  expect(() => debugAppFrom("  mDebugApp=com.android.settings; rm -rf / mDebugTransient=false")).toThrow("refusing to change it");
  expect(() => debugAppFrom("  mDebugApp=com.android.settings/unrecognized mDebugTransient=false")).toThrow("refusing to change it");
});

test("only an emulator device gets the Chrome debug setup a physical phone must not receive", () => {
  expect(isEmulatorDevice("emulator-5554", "")).toBe(true);
  expect(isEmulatorDevice("0A171FEE4004BW", "1")).toBe(true);
  expect(isEmulatorDevice("0A171FEE4004BW", "")).toBe(false);
});

test("artifact names stay inside their directory for hostile labels and truncate like the proxy", () => {
  const dir = join(tmpdir(), "home-artifact-dir");
  for (const label of ["../../workspace/home/profile-1", "feature/foo-1", "label with  spaces & punctu/ation", "l".repeat(90)]) {
    const name = artifactName(label, "home-fling", ".trace.json");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(resolve(dir, name).startsWith(`${dir}/`)).toBe(true);
    expect(name.endsWith("-home-fling.trace.json")).toBe(true);
    expect(safeName(safeName(label))).toBe(safeName(label));
  }
  expect(artifactName("", "home-fling", ".trace.json")).toBe("profile-home-fling.trace.json");
  const long = "l".repeat(60);
  expect(artifactName(`0-${long}-1`, "home-fling", ".json")).not.toBe(artifactName(`1-${long}-2`, "home-fling", ".json"));
  expect(artifactName(`0-${long}-1`, "home-fling", ".json")).toContain("0-");
});

test("a run id keeps its entropy when a long label pushes past the truncation limit", () => {
  const long = "l".repeat(90);
  const first = artifactName(runId(0, long, 1_000, "abc12345"), "home-fling", ".json");
  const laterRun = artifactName(runId(0, long, 2_000, "abc12345"), "home-fling", ".json");
  const otherProcess = artifactName(runId(0, long, 1_000, "def67890"), "home-fling", ".json");
  expect(first).not.toBe(laterRun);
  expect(first).not.toBe(otherProcess);
  expect(first).toContain("0-rs-abc12345-");
  expect(first).not.toContain(long);
});

test("the proxy names a result with the same suffix its client waits for", async () => {
  const dir = join(tmpdir(), `home-profile-label-${crypto.randomUUID()}`);
  try {
    await assertOutsideWorktree(dir);
    const handler = createHandler({ port: 4199, host: "127.0.0.1", upstream: "http://127.0.0.1:3199", rows: 300, outDir: dir }, "harness", "toolkit", () => 123456);
    for (const label of ["feature/foo-123", "../../workspace/home/profile-1", "label with spaces & punctuation", "l".repeat(90)]) {
      const plan = { workload: "home-fling" as const, rows: 20, repeat: 1, label, duration: 10 };
      const result: Result = { version: 1, plan, environment: { userAgent: "Chrome", viewport: { width: 412, height: 811 }, dpr: 2.625, standalone: false, navigatorStandalone: false, supportedEntryTypes: [] }, runs: [] };
      const response = await handler(new Request("http://localhost/__device-profile/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result) }));
      expect(response.status).toBe(200);
      const { filename } = await response.json() as { filename: string };
      expect(filename.endsWith(artifactName(label, plan.workload, ".json"))).toBe(true);
      expect(filename).not.toContain("/");
    }
  } finally {
    const process = Bun.spawn(["rm", "-r", "--", dir]);
    await process.exited;
  }
});

test("workloads enter the page that exposes their target control", () => {
  expect(routeFor("chart-scrub")).toBe("/invest/cbbtc");
  expect(routeFor("activity-detail-open")).toBe("/activity");
  expect(routeFor("nav-round-trips")).toBe("/home");
});

test("production targets use the workload route on a credential-free HTTPS origin", () => {
  expect(productionTarget("https://h.example/home", "chart-scrub")).toBe("https://h.example/invest/cbbtc");
  expect(productionTarget("https://h.example/home", "activity-detail-open")).toBe("https://h.example/activity");
  expect(productionTarget("https://h.example/activity", "home-fling")).toBe("https://h.example/home");
  expect(() => productionTarget("http://h.example/home", "home-fling")).toThrow("HTTPS");
  expect(() => productionTarget("https://user:pass@h.example/home", "home-fling")).toThrow("credentials");
});

test("loaded activity rows prefer a positive setsize then the highest position then the fallback", () => {
  expect(loadedRowCount([{ posinset: 17, setsize: -1 }, { posinset: 42, setsize: -1 }], 3)).toBe(42);
  expect(loadedRowCount([{ posinset: 42, setsize: -1 }, { posinset: 3, setsize: 120 }], 3)).toBe(120);
  expect(loadedRowCount([], 9)).toBe(9);
  expect(detailPosition(7)).toBe(4);
  expect(detailPosition(300)).toBe(151);
  expect(() => detailPosition(0)).toThrow();
  expect(() => detailPosition(Number.NaN)).toThrow();
  expect(settledPages(0, -1, 0)).toBe(0);
  expect(settledPages(10, 10, 0)).toBe(1);
  expect(settledPages(11, 10, 1)).toBe(0);
  expect(partialFeedComplete(0, 5)).toBe(false);
  expect(partialFeedComplete(1, 2)).toBe(true);
  expect(feedComplete({ pending: [], end: true, partialSourceCount: 0, settled: 0 })).toBe(true);
  expect(feedComplete({ pending: ["orders"], end: true, partialSourceCount: 0, settled: 5 })).toBe(false);
  expect(feedComplete({ pending: [], end: false, partialSourceCount: 1, settled: 2 })).toBe(true);
  expect(feedComplete({ pending: [], end: false, partialSourceCount: 0, settled: 5 })).toBe(false);
});

test("detail targets select the nearest eligible row to the midpoint and skip grouped rows", () => {
  const rows = [{ posinset: 1, detail: true }, { posinset: 4, detail: false }, { posinset: 5, detail: true }, { posinset: 7, detail: true }];
  expect(detailTarget(rows, detailPosition(7))).toBe(5);
  expect(detailTarget([{ posinset: 6, detail: true }, { posinset: 4, detail: true }], 5)).toBe(4);
  expect(detailTarget([{ posinset: 4, detail: false }], 4)).toBeNull();
  expect(detailTarget([], 4)).toBeNull();
  const invalid = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1].map((posinset) => ({ posinset, detail: true }));
  expect(detailTarget(invalid, 1)).toBeNull();
  expect(detailTarget([...invalid, { posinset: 3, detail: true }], 1)).toBe(3);
});

test("feed changes after the fill mark the measured run partial", () => {
  expect(feedChangeMarker(20, 20)).toBeNull();
  expect(feedChangeMarker(20, 24)).toBe("The measured activity feed changed during the run (20 to 24 rows)");
});

test("sources still loading when the run ends mark the measured run partial", () => {
  expect(unsettledMarker([])).toBeNull();
  expect(unsettledMarker(["orders"])).toBe("The activity feed was still loading when the run ended (orders)");
});

test("the post-run quiet period finalizes clean only after an unchanged, settled feed", async () => {
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: 1,
    quietMs: 500,
    now: () => now,
    frame: async () => { now += 16; },
    sample: () => ({ rows: 1, pending: [], markers: [] }),
  });
  expect(markers).toEqual([]);
  expect(now).toBeGreaterThanOrEqual(500);
});

test("a feed change that lands after the run marks the run partial", async () => {
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: 1,
    quietMs: 500,
    now: () => now,
    frame: async () => { now += 16; },
    sample: () => ({ rows: now >= 160 ? 2 : 1, pending: [], markers: [] }),
  });
  expect(markers).toEqual(["The measured activity feed changed during the run (1 to 2 rows)"]);
  expect(now).toBe(160);
});

test("a source that starts loading after the run marks the run partial", async () => {
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: 1,
    quietMs: 500,
    now: () => now,
    frame: async () => { now += 16; },
    sample: () => ({ rows: 1, pending: now >= 160 ? ["transfers"] : [], markers: [] }),
  });
  expect(markers).toEqual(["The activity feed was still loading when the run ended (transfers)"]);
  expect(now).toBe(160);
});

test("a readiness problem that appears after the run marks the run partial", async () => {
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: 1,
    quietMs: 500,
    now: () => now,
    frame: async () => { now += 16; },
    sample: () => ({ rows: 1, pending: [], markers: now >= 160 ? ["Activity source orders reported error"] : [] }),
  });
  expect(markers).toEqual(["Activity source orders reported error"]);
  expect(now).toBe(160);
});

test("a dirty post-run sample keeps every observed marker", async () => {
  let now = 0;
  const markers = await waitForQuietFeed({
    rows: 1,
    quietMs: 500,
    now: () => now,
    frame: async () => { now += 16; },
    sample: () => ({ rows: now >= 160 ? 2 : 1, pending: now >= 160 ? ["transfers"] : [], markers: now >= 160 ? ["Activity source orders reported error"] : [] }),
  });
  expect(markers).toEqual([
    "The measured activity feed changed during the run (1 to 2 rows)",
    "The activity feed was still loading when the run ended (transfers)",
    "Activity source orders reported error",
  ]);
});

test("a source still loading when the measurement ends marks the run partial", async () => {
  const markers = await waitForQuietFeed({
    rows: 1,
    pending: ["orders"],
    quietMs: 0,
    frame: async () => {},
    sample: () => ({ rows: 1, pending: [], markers: [] }),
  });
  expect(markers).toEqual(["The activity feed was still loading when the run ended (orders)"]);
});

test("production all runs each fling once using the plan placeholder while the fixture matrix keeps 11 entries", () => {
  const production = matrix("all", 42, true);
  expect(production).toHaveLength(7);
  expect(production.filter((entry) => entry.workload.endsWith("-fling"))).toEqual([{ workload: "home-fling", rows: 42 }, { workload: "activity-fling", rows: 42 }]);
  expect(production.every((entry) => entry.rows === 42)).toBe(true);
  expect(matrix("all", 300, false)).toHaveLength(11);
  expect(matrix("all", 300, false).slice(0, 6)).toEqual([20, 100, 300].flatMap((rows) => [{ workload: "home-fling", rows }, { workload: "activity-fling", rows }]));
});

test("command flags reject unsupported options and ignored production flags", () => {
  expect(() => parseArgs("ios-sim", ["--repeet", "3"])).toThrow("Unknown --repeet for ios-sim");
  expect(() => parseArgs("android", ["--public"])).toThrow("Unknown --public for android");
  expect(() => parseArgs("android", ["--url", "https://x", "--rows", "20"])).toThrow("--rows is not supported with --url");
  expect(() => parseArgs("android", ["--port", "4199", "--url", "https://x"])).toThrow("--port is not supported with --url");
  expect(parseArgs("ios-sim", ["--device", "iPhone", "--repeat", "3"])).toEqual({ flags: new Map([["device", "iPhone"], ["repeat", "3"]]), paths: [] });
  expect(parseArgs("android", ["--serial", "device", "--url", "https://x", "--trace", "/tmp/traces"])).toEqual({ flags: new Map([["serial", "device"], ["url", "https://x"], ["trace", "/tmp/traces"]]), paths: [] });
  expect(parseArgs("serve", ["--port", "4199", "--rows", "20"])).toEqual({ flags: new Map([["port", "4199"], ["rows", "20"]]), paths: [] });
  expect(parseArgs("summarize", ["one.json", "--markdown", "two.json"])).toEqual({ flags: new Map([["markdown", "true"]]), paths: ["one.json", "two.json"] });
  expect(parseArgs("summarize", ["--include-partial", "one.json"])).toEqual({ flags: new Map([["include-partial", "true"]]), paths: ["one.json"] });
});

test("summary distinguishes measured production rows from fixture plan rows", () => {
  const result = { environment: { userAgent: "Chrome" }, plan: { workload: "activity-detail-open", rows: 300 }, runs: [{ periodMs: 16.67, missedDeadlinePct: 0, longFrameCount: 0, frameMs: { p95: 17 }, feedbackMs: [] as number[], rowsLoaded: 42 }] } as Result;
  expect(summarize([result])).toContain("Chrome | activity-detail-open | 42 |");
  result.runs[0]!.rowsLoaded = undefined;
  expect(summarize([result])).toContain("Chrome | activity-detail-open | — |");
  result.environment.fixture = { tokenImages: "omitted" };
  expect(summarize([result])).toContain("Chrome | activity-detail-open | 300 |");
  result.runs[0]!.partialSource = ["Onchain transfers are unavailable."];
  expect(summarize([result], true)).toContain("| Onchain transfers are unavailable. |");
  expect(summarize([result], true)).toContain("| excluded 1/1 partial |");
  expect(summarize([result], true, true)).toContain("| 300 | — | 16.67 | 0 | 0 | 17 | — | — | 0 | Onchain transfers are unavailable. |");
});

test("summary computes percentiles, median, trace totals and replaceState count", () => {
  expect(median([6, 2, 4, 8])).toBe(5);
  expect(percentile([10, 40, 20, 30], 0.95)).toBe(40);
  expect(safeName("../../unsafe")).toBe("______unsafe");
  const result = { environment: { userAgent: "Safari", fixture: { tokenImages: "omitted" } }, plan: { workload: "replace-state-probe", rows: 20 }, runs: [{ periodMs: 16.67, missedDeadlinePct: 5, longFrameCount: 1, frameMs: { p95: 20 }, feedbackMs: [5, 10, 20], replaceState: [{ errors: [{ name: "SecurityError", message: "limited" }] }] }] } as Result;
  expect(summarize([result], true)).toContain("| Safari | replace-state-probe | 20 | — | 16.67 | 5 | 1 | 20 | 10 | — | 1 | — |");
  const fling = { environment: { userAgent: "Chrome", fixture: { tokenImages: "omitted" } }, plan: { workload: "home-fling", rows: 20 }, runs: [{ periodMs: 16.67, missedDeadlinePct: 0, longFrameCount: 0, frameMs: { p95: 17 }, feedbackMs: [] as number[] }] } as Result;
  expect(summarize([fling], true)).toContain("| Chrome | home-fling | 20 | — | 16.67 | 0 | 0 | 17 | — | — | 0 | — |");
  const table = summarize([fling], true).split("\n");
  const cells = (line: string) => line.split("|").length;
  expect(cells(table[0]!)).toBe(15);
  expect(cells(table[1]!)).toBe(cells(table[0]!));
  expect(cells(table[2]!)).toBe(cells(table[0]!));
});

test("summary excludes partial measurements by default and includes them on request", () => {
  const run = runFor({ periodMs: 16.67, missedDeadlinePct: 9, longFrameCount: 2, frameMs: { p50: 16, p95: 40, p99: 50, max: 60 }, rowsLoaded: 151, groupedRows: 2, underlyingRows: 153, partial: true, partialSource: ["Activity source orders reported error"] });
  const result = resultFor([run], { plan: { workload: "activity-fling", rows: 300, label: "test", repeat: 1, duration: 10 } });
  const excluded = summarize([result], true).split("\n"), included = summarize([result], true, true).split("\n");
  expect(excluded).toHaveLength(3);
  expect(excluded.at(-1)).toBe("| Chrome | activity-fling | — | — | — | — | — | — | — | — | — | Activity source orders reported error | excluded 1/1 partial |");
  expect(included).toHaveLength(3);
  expect(included.at(-1)).toBe("| Chrome | activity-fling | 151 | 2/153 | 16.67 | 9 | 2 | 40 | — | — | 0 | Activity source orders reported error | ok 1/1 |");
  expect(included.at(0)).toContain("| Rows | Grouped/underlying | Period ms |");
  for (const table of [excluded, included]) for (const line of table) expect(line.split("|")).toHaveLength(15);
  expect(runPartial(run)).toBe(true);
  run.partial = undefined;
  expect(runPartial(run)).toBe(true);
  expect(summarize([result])).toContain("excluded 1/1 partial");
  run.partialSource = undefined;
  expect(runPartial(run)).toBe(false);
  run.partial = true;
  expect(summarize([result])).toContain("| — | excluded 1/1 partial");
});

test("summary preserves failures and incomplete results when every run is excluded as partial", () => {
  const run = runFor({ partial: true, partialSource: ["Orders unavailable"] });
  const cases: [Partial<Result>, string][] = [
    [{ error: "Timed out | waiting\nfor rows" }, "failed 1/3: Timed out waiting for rows"],
    [{}, "incomplete 1/3"],
  ];
  for (const [overrides, status] of cases) {
    const result = resultFor([run], { plan: { workload: "activity-fling", rows: 300, label: "test", repeat: 3, duration: 10 }, ...overrides });
    const summary = summarize([result]);
    expect(summary.split("\n")).toHaveLength(2);
    expect(summary).toContain(`excluded 1/3 partial; ${status}`);
    const markdown = summarize([result], true).split("\n");
    expect(markdown).toHaveLength(3);
    expect(markdown.at(-1)).toEndWith(`| Orders unavailable | excluded 1/3 partial; ${status} |`);
    for (const line of markdown) expect(line.split("|")).toHaveLength(15);
  }
});

test("summary aggregates unique partial sources after measured rows with consistent cells", () => {
  const plain = runFor();
  const run = runFor({ partialSource: ["Orders unavailable", "Transfers unavailable"] });
  const partial = runFor({ partial: true, partialSource: ["Orders unavailable"] });
  const result = resultFor([run, plain, partial], { plan: { workload: "activity-fling", rows: 300, label: "test", repeat: 3, duration: 10 } });
  const table = summarize([result], true).split("\n");
  expect(table).toHaveLength(4);
  expect(table.at(2)).toContain("| — | — | 16.67 | 0 | 0 | 17 | — | — | 0 | — | ok 3/3 |");
  expect(table.at(-1)).toEndWith("| Orders unavailable; Transfers unavailable | excluded 2/3 partial |");
  for (const line of table) expect(line.split("|")).toHaveLength(15);
  const included = summarize([result], true, true).split("\n");
  expect(included).toHaveLength(5);
  expect(included.some((line) => line.includes("excluded"))).toBe(false);
  for (const line of included) expect(line.split("|")).toHaveLength(15);
  const marker = "The activity feed has a grouped run whose transfer count could not be read";
  run.partialSource = [marker, "Orders unavailable"];
  expect(summarize([result], true)).toContain("| The activity feed has a grouped run whose transfer count could not be read; Orde | excluded 2/3 partial |");
});

test("summary surfaces failed and incomplete results with completed repeat counts", () => {
  const run = { periodMs: 16.67, missedDeadlinePct: 0, longFrameCount: 0, frameMs: { p95: 17 }, feedbackMs: [] as number[] };
  const base = { environment: { userAgent: "Safari", fixture: { tokenImages: "omitted" } }, plan: { workload: "home-fling", rows: 20, repeat: 3 } };
  const failed = { ...base, runs: [], error: "Timed out | waiting\nfor rows" } as unknown as Result;
  const table = summarize([failed], true).split("\n");
  expect(table).toHaveLength(3);
  expect(table[2]).toBe("| Safari | home-fling | 20 | — | — | — | — | — | — | — | — | — | failed 0/3: Timed out waiting for rows |");
  expect(table[2]!.split("|").length).toBe(table[0]!.split("|").length);
  const partial = { ...base, runs: [run], error: "Frame budget lost" } as unknown as Result;
  expect(summarize([partial])).toContain("| failed 1/3: Frame budget lost");
  const incomplete = { ...base, runs: [run, run] } as unknown as Result;
  expect(summarize([incomplete]).split("\n").slice(1).every((line) => line.endsWith("| incomplete 2/3"))).toBe(true);
  expect(summarize([{ ...base, runs: [run, run, run] } as unknown as Result])).toContain("| ok 3/3");
});

test("a failed device probe is reported instead of an empty inventory", async () => {
  const unavailable: string[] = [], reported: string[] = [];
  const report = (name: string) => reported.push(name);
  expect(await probeInto(unavailable, "ios-phones", async () => ["found"], [], report)).toEqual(["found"]);
  expect(unavailable).toEqual([]);
  expect(await probeInto(unavailable, "ios-phones", async () => { throw new Error("devicectl missing"); }, [] as string[], report)).toEqual([]);
  expect(await probeInto(unavailable, "android", async () => { throw new Error("adb missing"); }, [] as string[], report)).toEqual([]);
  expect(unavailable).toEqual(["ios-phones", "android"]);
  expect(reported).toEqual(["ios-phones", "android"]);
});

test("adb rows are parsed strictly so a failed or partial listing is not read as empty", () => {
  expect(parseAdbDevices("List of devices attached\n0A171FEE4004BW        device product:husky model:Pixel_8 device:husky\n")).toEqual([{ serial: "0A171FEE4004BW", state: "device" }]);
  expect(parseAdbDevices("List of devices attached\n0A171FEE4004BW       unauthorized usb:1-1\n")).toEqual([{ serial: "0A171FEE4004BW", state: "unauthorized" }]);
  expect(parseAdbDevices("List of devices attached\n0A171FEE4004BW       offline\n")).toEqual([{ serial: "0A171FEE4004BW", state: "offline" }]);
  expect(parseAdbDevices("List of devices attached\n* daemon started successfully\n0A171FEE4004BW\tdevice\n")).toEqual([{ serial: "0A171FEE4004BW", state: "device" }]);
  expect(parseAdbDevices("List of devices attached\n")).toEqual([]);
  expect(() => parseAdbDevices("adb server version (41) does not match this client\n0A171FEE4004BW\tdevice\n")).toThrow("unrecognized adb device list");
  expect(() => parseAdbDevices("List of devices attached\n0A171FEE4004BW\tconnected\n")).toThrow("unrecognized adb device row");
  expect(() => parseAdbDevices("List of devices attached\n0A171FEE4004BW\n")).toThrow("unrecognized adb device row");
  expect(() => parseAdbDevices("List of devices attached\n0A171FEE4004BW\tdevice\n0A171FEE4004BW\tdevice\n")).toThrow("duplicate adb device row");
});

test("public Android rows report a derived family, never the vendor string", () => {
  const device = { model: "Pixel_8", release: "15", chrome: "124.0.6367.219", serial: "SECRETSERIAL123" };
  expect(androidView(device, true)).toEqual({ family: "Pixel", release: "15", chrome: "124.0.6367.219" });
  expect(androidView({ model: "Pixel 8 Pro", release: "15", chrome: "unavailable" }, true)).toEqual({ family: "Pixel", release: "15", chrome: "unavailable" });
  expect(androidView({ model: "SM-S911B", release: "14", chrome: "124.0.6367.219" }, true).family).toBe("Samsung Galaxy");
  expect(androidView({ model: "sdk_gphone64_arm64", release: "15", chrome: "124" }, true).family).toBe("Android");
  expect(androidView(device, false)).toEqual(device);
  for (const model of ["Pixel 8 PrivateStudioPhone", "Pixel 8 <script>Jesse", "Jesse's phone"]) {
    const view = androidView({ model, release: "15551234567", chrome: "124.0.6367.219.1", serial: "SECRETSERIAL123" }, true);
    expect(JSON.stringify(view)).not.toContain("Jesse");
    expect(JSON.stringify(view)).not.toContain("PrivateStudioPhone");
    expect(view.release).toBe("unknown");
    expect(view.chrome).toBe("unknown");
  }
  expect(androidView({ model: "Pixel 8 PrivateStudioPhone", release: "15", chrome: "124" }, true).family).toBe("Pixel");
  expect(androidView({ model: "Jesse's phone", release: "15", chrome: "124" }, true).family).toBe("Android");
  expect(androidFamily("Pixel 8 Pro")).toBe("Pixel");
  expect(androidFamily("SM-S911B")).toBe("Samsung Galaxy");
  expect(androidFamily("Jesse Private Phone")).toBe("Android");
  const hostileVersions = androidView({ model: "Pixel 8 Jesse Private", release: "15.12345", chrome: "124.0.55555.219", serial: "SECRETSERIAL123" }, true);
  expect(hostileVersions).toEqual({ family: "Pixel", release: "unknown", chrome: "unknown" });
  expect(JSON.stringify(hostileVersions)).not.toContain("12345");
  expect(JSON.stringify(hostileVersions)).not.toContain("55555");
  expect(phoneView({ name: "Jesse", platform: "iOS", deviceType: "iPhone 16 Pro", osVersion: "26.12345", udid: "x" }, true)).toEqual({ platform: "iOS", deviceType: "iPhone", osVersion: "unknown" });
  expect(phoneView({ name: "Jesse", platform: "iOS", deviceType: "iPhone 16 Pro", osVersion: "26.1", udid: "x" }, true).osVersion).toBe("26.1");
  expect(androidView({ model: "Pixel 8", release: "15", chrome: "124.0.6367.219" }, true).chrome).toBe("124.0.6367.219");
});

test("public inventory reports only canonical facts", () => {
  const phone = { name: "Jesse's iPhone", platform: "iOS", deviceType: "iPhone 16 Pro", osVersion: "26.1", udid: "00008120-000A1B2C3D4E5F60" };
  expect(phoneView(phone, true)).toEqual({ platform: "iOS", deviceType: "iPhone", osVersion: "26.1" });
  expect(JSON.stringify(phoneView(phone, true))).not.toContain("Jesse");
  expect(phoneView(phone, false)).toEqual({ name: "Jesse's iPhone", platform: "iOS", deviceType: "iPhone 16 Pro", osVersion: "26.1", udid: "00008120-000A1B2C3D4E5F60" });
  expect(phoneView({ name: "", platform: undefined, udid: null }, true)).toEqual({ platform: "unknown", deviceType: "unknown" });
  expect(phoneView({}, false)).toEqual({});
  const known = { runtimes: new Set(["com.apple.CoreSimulator.SimRuntime.iOS-26-2"]), deviceTypes: new Set(["com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"]) };
  const simulator = { runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iPhone 17 Pro", state: "Shutdown", udid: "8A0E1F2C-3D4B-5A69-7C8D-9E0F1A2B3C4D", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" };
  expect(simulatorView(simulator, true, known)).toEqual({ os: "iOS", osVersion: "26.2", family: "iPhone", state: "Shutdown" });
  expect(simulatorView(simulator, false, known)).toEqual({ runtime: simulator.runtime, name: simulator.name, state: simulator.state, udid: simulator.udid });
  for (const name of ["Jesse's test phone", "iPhone 17 Pro - Jesse private phone", "iPhone 17 Pro"]) {
    const view = simulatorView({ ...simulator, name }, true, known);
    expect(view).toEqual({ os: "iOS", osVersion: "26.2", family: "iPhone", state: "Shutdown" });
    expect(JSON.stringify(view)).not.toContain("Jesse");
    expect(JSON.stringify(view)).not.toContain("iPhone 17 Pro");
  }
  const { deviceTypeIdentifier: _deviceTypeIdentifier, ...withoutType } = simulator;
  expect(simulatorView(withoutType, true, known)).toEqual({ os: "iOS", osVersion: "26.2", family: "unknown", state: "Shutdown" });
  const hostileIdentifiers = { ...simulator, runtime: "error: owner private", state: "Jesse's private phone", deviceTypeIdentifier: "</script>Jesse" };
  const hostileView = simulatorView(hostileIdentifiers, true, known);
  expect(hostileView).toEqual({ os: "unknown", family: "unknown", state: "unknown" });
  expect(JSON.stringify(hostileView)).not.toContain("Jesse");
  const appendedIdentifier = { ...simulator, runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2-Jesse", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Jesse-private" };
  expect(simulatorView(appendedIdentifier, true, known)).toEqual({ os: "unknown", family: "unknown", state: "Shutdown" });
  const fabricated = { ...simulator, runtime: "com.apple.CoreSimulator.SimRuntime.iOS.26.2.Private", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone.PrivateStudioPhone" };
  const fabricatedKnown = { runtimes: new Set([fabricated.runtime]), deviceTypes: new Set([fabricated.deviceTypeIdentifier]) };
  const fabricatedView = simulatorView(fabricated, true, fabricatedKnown);
  expect(fabricatedView).toEqual({ os: "unknown", family: "unknown", state: "Shutdown" });
  expect(JSON.stringify(fabricatedView)).not.toContain("Private");
  const hostilePhone = { name: "Jesse", platform: "Jesse's private phone", deviceType: "iPhone 17 Pro - Jesse private phone", osVersion: "Jesse's phone", udid: "x" };
  const hostilePhoneView = phoneView(hostilePhone, true);
  expect(hostilePhoneView).toEqual({ platform: "unknown", deviceType: "iPhone", osVersion: "unknown" });
  expect(JSON.stringify(hostilePhoneView)).not.toContain("Jesse");
  expect(phoneView({ ...phone, deviceType: "iPad Pro 11-inch" }, true).deviceType).toBe("iPad");
  expect(phoneView({ ...phone, platform: "iPadOS" }, true).platform).toBe("iPadOS");
  expect(phoneFamily("Apple Vision Pro")).toBe("Apple Vision");
  expect(phoneFamily("iPhone")).toBe("iPhone");
  expect(phoneFamily("Jesse's iPhone")).toBe("unknown");
  expect(duplicateValues(["a", "b", "a", "c", "c"])).toEqual(["a", "c"]);
  expect(duplicateValues([])).toEqual([]);
  expect(duplicateValues([])).toEqual([]);
});


test("saved results must carry every field the summary reads", () => {
  const run = { frameCount: 60, periodMs: 16.67, missedDeadlinePct: 0, longFrameCount: 0, frameMs: { p50: 16, p95: 17, p99: 18, max: 20 }, feedbackMs: [] as number[] };
  const result = { version: 1, plan: { workload: "home-fling", rows: 20, repeat: 1, label: "x", duration: 10 }, environment: { userAgent: "Safari" }, runs: [run] };
  expect(validResult(result)).toBe(true);
  const { frameMs: _frameMs, ...missingFrames } = run;
  expect(validResult({ ...result, runs: [missingFrames] })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, replaceState: [{}] }] })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, partialSource: [1] }] })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, partial: true, groupedRows: 2, underlyingRows: 153 }] })).toBe(true);
  expect(validResult({ ...result, runs: [{ ...run, partial: false }] })).toBe(true);
  expect(validResult({ ...result, runs: [{ ...run, partial: "true" }] })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, groupedRows: "2" }] })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, underlyingRows: "153" }] })).toBe(false);
  expect(validResult({ ...result, runs: [null] })).toBe(false);
  expect(validResult({ ...result, traceError: 3 })).toBe(false);
  expect(validResult({ ...result, runs: [{ ...run, trace: { scriptMs: 5, styleMs: 1, layoutMs: 2, paintMs: 3 } }] })).toBe(true);
  expect(validResult({ ...result, runs: [{ ...run, trace: { scriptMs: 5 } }] })).toBe(false);
  expect(() => summarize([result as unknown as Result])).not.toThrow();
});

const mainThread: TraceEvent = { name: "thread_name", ph: "M", pid: 7, tid: 8, args: { name: "CrRendererMain" } };
const mark = (name: "start" | "end", ts: number): TraceEvent => ({ name: `home-device-profile:measure-${name}`, ph: "I", cat: "blink.user_timing", pid: 7, tid: 8, ts });
const span = (name: string, ts: number, dur: number, pid = 7, tid = 8): TraceEvent => ({ name, ph: "X", pid, tid, ts, dur });

test("trace totals clip measured windows, attribute nested work as self time, and ignore unmeasured activity and other threads", () => {
  const events = [mainThread, mark("start", 10000), mark("end", 20000), mark("start", 30000), mark("end", 40000),
    span("FunctionCall", 0, 1000), span("FunctionCall", 8000, 7000), span("EvaluateScript", 11000, 2000),
    span("Layout", 18000, 4000), span("Paint", 12000, 1000, 7, 9), span("Paint", 12000, 1000, 9, 8),
    span("UpdateLayoutTree", 15000, 1000), span("RecalculateStyles", 15300, 300),
    span("Paint", 31000, 1500), span("FunctionCall", 39000, 2000), span("Layout", 39200, 300), span("Layout", 21000, 8000)];
  expect(traceTotals(events, 2)).toEqual({ runs: [
    { scriptMs: 5, styleMs: 1, layoutMs: 2, paintMs: 0 },
    { scriptMs: 0.7, styleMs: 0, layoutMs: 0.3, paintMs: 1.5 },
  ] });
  expect(traceTotals(events, 1, 1).runs).toEqual([{ scriptMs: 0.7, styleMs: 0, layoutMs: 0.3, paintMs: 1.5 }]);
});

test("trace totals omit numbers and explain missing or invalid renderer marks", () => {
  const missing = traceTotals([mainThread, span("Layout", 0, 50000)], 1);
  expect(missing.runs).toEqual([null]);
  expect(missing.error).toContain("found 0 marks");
  const unpaired = traceTotals([mainThread, mark("end", 10000), mark("start", 20000)], 1);
  expect(unpaired.runs).toEqual([null]);
  expect(unpaired.error).toContain("unpaired");
  const otherThread = traceTotals([mainThread, { ...mark("start", 10000), tid: 9 }, mark("end", 20000)], 1);
  expect(otherThread.runs).toEqual([null]);
  expect(otherThread.error).toContain("CrRendererMain");
});

test("simulator selection rejects an ambiguous name instead of guessing a runtime", () => {
  const devices = [
    { runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iPhone 17 Pro", udid: "SIM-A", state: "Shutdown" },
    { runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1", name: "iPhone 17 Pro", udid: "SIM-B", state: "Shutdown" },
    { runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iPad Air", udid: "SIM-C", state: "Booted" },
  ];
  expect(simulatorRuntimeVersion("com.apple.CoreSimulator.SimRuntime.iOS-26-2")).toBe("26.2");
  expect(simulatorRuntimeVersion("com.apple.CoreSimulator.SimRuntime.iOS-26-2-private")).toBeNull();
  expect(() => selectSimulator(devices, "iPhone 17 Pro")).toThrow("matches 2 runtimes (iPhone 17 Pro@26.2, iPhone 17 Pro@26.1)");
  expect(selectSimulator(devices, "iPhone 17 Pro@26.1")).toEqual(devices[1]);
  expect(selectSimulator(devices, "iPhone 17 Pro@com.apple.CoreSimulator.SimRuntime.iOS-26-2")).toEqual(devices[0]);
  expect(selectSimulator(devices, "SIM-A")).toEqual(devices[0]);
  expect(selectSimulator(devices, "iPad Air")).toEqual(devices[2]);
  expect(() => selectSimulator(devices, "iPhone 17 Pro@26.0")).toThrow("Simulator not available: iPhone 17 Pro@26.0");
  expect(() => selectSimulator(devices, "iPad Air@26.1")).toThrow("Simulator not available: iPad Air@26.1");
  expect(() => selectSimulator(devices, "iPhone 17 Pro@")).toThrow("Empty runtime qualifier");
});

test("a result failure names the run's own error before an incomplete repeat count", () => {
  const plan = { workload: "home-fling" as const, rows: 20, repeat: 2, label: "device", duration: 10 };
  const environment = { userAgent: "Safari", viewport: { width: 390, height: 844 }, dpr: 3, standalone: false, navigatorStandalone: false, supportedEntryTypes: [] };
  const run = { frameCount: 1, periodMs: 16, missedDeadlinePct: 0, longFramePct: 0, longFrameCount: 0, frameMs: { p50: 16, p95: 16, p99: 16, max: 16 }, feedbackMs: [], blankCheck: { framesWithBlank: 0, maxBlankPx: 0 }, longTasks: { count: 0, totalMs: 0 }, loaf: { count: 0, totalMs: 0, blockingMs: 0 } };
  expect(resultFailure({ version: 1, plan, environment, runs: [run, run] })).toBeNull();
  expect(resultFailure({ version: 1, plan, environment, runs: [run] })).toBe("Incomplete result: 1/2 runs");
  expect(resultFailure({ version: 1, plan, environment, runs: [], error: "Missing asset price chart control" })).toBe("Missing asset price chart control");
});

test("a hidden page or a frame-less measurement is an invalid run, not a clean zero", () => {
  expect(visibilityProblem("visible")).toBeNull();
  expect(visibilityProblem("visible", true)).toContain("hidden during the measurement");
  expect(frameProblem(3)).toBeNull();
  expect(visibilityProblem("hidden")).toContain("not visible");
  expect(visibilityProblem("prerender")).toContain("not visible");
  expect(frameProblem(0)).toContain("No animation frame");
});

test("the emulator Chrome snapshot separates an absent file from a failed read", async () => {
  const absent = async () => { throw new Error("adb: shell: ls: /data/local/tmp/chrome-command-line: No such file or directory"); };
  expect(await chromeCommandLineSnapshot(absent)).toBeNull();
  const offline = async () => { throw new Error("adb: error: device offline"); };
  await expect(chromeCommandLineSnapshot(offline)).rejects.toThrow("device offline");
  const present = async (args: string[]) => args[1] === "ls" ? "/data/local/tmp/chrome-command-line\n" : "AAEC\nAwQF\n";
  expect(await chromeCommandLineSnapshot(present)).toBe("AAECAwQF");
  const unreadable = async (args: string[]) => { if (args[1] === "ls") return "path\n"; throw new Error("read failed"); };
  await expect(chromeCommandLineSnapshot(unreadable)).rejects.toThrow("read failed");
});
test("the device lock excludes a second run and reports an interrupted owner's lock", async () => {
  const key = `test-device-${crypto.randomUUID()}`;
  const path = join(tmpdir(), `home-device-profile-${safeName(key)}.lock`);
  const release = await acquireDeviceLock(key);
  await expect(acquireDeviceLock(key)).rejects.toThrow("already using");
  await release();
  const again = await acquireDeviceLock(key);
  await again();
  await Bun.write(path, "");
  await expect(acquireDeviceLock(key)).rejects.toThrow("already using");
  await Bun.write(path, "999999junk");
  await expect(acquireDeviceLock(key)).rejects.toThrow("already using");
  await Bun.write(path, "999999");
  await expect(acquireDeviceLock(key)).rejects.toThrow("was interrupted");
});
test("a live lock with a running owner stays in place", async () => {
  const key = `test-device-${crypto.randomUUID()}`;
  const path = join(tmpdir(), `home-device-profile-${safeName(key)}.lock`);
  await Bun.write(path, String(process.pid));
  await expect(acquireDeviceLock(key)).rejects.toThrow("already using");
  await expect(acquireDeviceLock(key)).rejects.toThrow("already using");
});


const simulatorList = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{ name: "iPhone 17 Pro", udid: "SIM-UDID-1", state: "Shutdown", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }, { name: "iPhone 17 Pro - Jesse private phone", udid: "SIM-UDID-2", state: "Booted", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }], "com.apple.CoreSimulator.SimRuntime.iOS-26-2-Jesse-private": [{ name: "iPhone 17 Pro", udid: "SIM-UDID-3", state: "Shutdown", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Jesse-private" }] }, runtimes: [{ identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2" }], devicetypes: [{ identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }] });
const phoneList = JSON.stringify({ result: { devices: [{ deviceProperties: { name: "Jesse iPhone", deviceType: "iPhone 16 Pro", osVersionNumber: "26.1" }, hardwareProperties: { udid: "00008120-000A1B2C", platform: "iOS" } }] } });
const xcrunShim = ["#!/bin/sh", "if [ \"$1\" = \"simctl\" ]; then cat \"$STUB_DIR/simctl.json\"; exit 0; fi", "if [ \"$1\" = \"devicectl\" ]; then for arg in \"$@\"; do out=\"$arg\"; done; cp \"$STUB_DIR/devicectl.json\" \"$out\"; exit 0; fi", "exit 1"].join("\n");
const adbShim = ["#!/bin/sh", "if [ \"$1\" = \"devices\" ]; then cat \"$STUB_DIR/adb-devices.txt\"; exit 0; fi", "case \"$4:$5\" in", "  getprop:ro.product.model) printf Pixel_8 ;;", "  getprop:ro.build.version.release) printf 15 ;;", "  dumpsys:*) printf 'versionName=124.0.6367.219' ;;", "esac"].join("\n");
const runInventory = async (stubs: { xcrunOk?: boolean; adbOk?: boolean; simctl?: string; devicectl?: string; adbDevices?: string; publicView?: boolean } = {}) => {
  const dir = join(tmpdir(), `home-inventory-${crypto.randomUUID()}`), bin = join(dir, "bin"), sdk = join(dir, "sdk/platform-tools"), tree = join(dir, "stubs");
  await Bun.write(join(tree, "simctl.json"), stubs.simctl ?? simulatorList);
  await Bun.write(join(tree, "devicectl.json"), stubs.devicectl ?? phoneList);
  await Bun.write(join(tree, "adb-devices.txt"), stubs.adbDevices ?? "List of devices attached\nSECRETSERIAL123\tdevice product:husky model:Pixel_8\n");
  const failing = "#!/bin/sh\nexit 1", tools = [[join(bin, "xcrun"), stubs.xcrunOk === false ? failing : xcrunShim], [join(sdk, "adb"), stubs.adbOk === false ? failing : adbShim]] as const;
  for (const [path, script] of tools) { await Bun.write(path, script); await Bun.spawn(["chmod", "755", path]).exited; }
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "cli.ts"), "inventory", ...stubs.publicView === false ? [] : ["--public"]], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: tree, ANDROID_HOME: join(dir, "sdk") }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await Bun.spawn(["rm", "-rf", dir]).exited;
  return { stdout, stderr, code, json: JSON.parse(stdout.slice(0, stdout.indexOf("\n}\n") + 2)) as { simulators: Record<string, string>[]; phones: Record<string, string>[]; android: Record<string, string>[]; unavailable: string[] } };
};

test("inventory --public reports what it found without identifiers", async () => {
  const { stdout, stderr, code, json } = await runInventory();
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(json.unavailable).toEqual([]);
  expect(json.phones).toEqual([{ platform: "iOS", deviceType: "iPhone", osVersion: "26.1" }]);
  expect(json.simulators).toEqual([{ os: "iOS", osVersion: "26.2", family: "iPhone", state: "Shutdown" }, { os: "iOS", osVersion: "26.2", family: "iPhone", state: "Booted" }, { os: "unknown", family: "unknown", state: "Shutdown" }]);
  expect(json.android).toEqual([{ family: "Pixel", release: "15", chrome: "124.0.6367.219" }]);
  for (const secret of ["Jesse", "00008120-000A1B2C", "SIM-UDID-1", "SIM-UDID-2", "SECRETSERIAL123", "iPhone 17 Pro", "core-simulator"]) { expect(stdout).not.toContain(secret); expect(stderr).not.toContain(secret); }
});

test("inventory keeps the private view for the operator", async () => {
  const { stdout, code, json } = await runInventory({ publicView: false });
  expect(code).toBe(0);
  expect(json.phones).toEqual([{ name: "Jesse iPhone", platform: "iOS", deviceType: "iPhone 16 Pro", osVersion: "26.1", udid: "00008120-000A1B2C" }]);
  expect(json.simulators[1]).toEqual({ runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iPhone 17 Pro - Jesse private phone", state: "Booted", udid: "SIM-UDID-2" });
  expect(json.simulators[2]).toEqual({ runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2-Jesse-private", name: "iPhone 17 Pro", state: "Shutdown", udid: "SIM-UDID-3" });
  expect(stdout).toContain("SECRETSERIAL123");
});

test("an empty device list from a successful probe stays a clean empty", async () => {
  const { code, json } = await runInventory({ devicectl: JSON.stringify({ result: { devices: [] } }), adbDevices: "List of devices attached\n" });
  expect(code).toBe(0);
  expect(json.unavailable).toEqual([]);
  expect(json.phones).toEqual([]);
  expect(json.android).toEqual([]);
});

test("a malformed physical-phone or simulator probe is unavailable instead of an empty success", async () => {
  const malformed = await runInventory({ devicectl: JSON.stringify({ result: {} }) });
  expect(malformed.code).toBe(1);
  expect(malformed.json.unavailable).toEqual(["ios-phones"]);
  expect(malformed.json.phones).toEqual([]);
  const incompletePhone = await runInventory({ devicectl: JSON.stringify({ result: { devices: [{ deviceProperties: { name: "Jesse iPhone" }, hardwareProperties: { udid: "00008120-000A1B2C", platform: "iOS" } }] } }) });
  expect(incompletePhone.code).toBe(1);
  expect(incompletePhone.json.unavailable).toEqual(["ios-phones"]);
  expect(incompletePhone.json.phones).toEqual([]);
  expect(incompletePhone.stderr).not.toContain("Jesse");
  const duplicatePhone = await runInventory({ devicectl: JSON.stringify({ result: { devices: [{ deviceProperties: { name: "Jesse iPhone", deviceType: "iPhone 16 Pro", osVersionNumber: "26.1" }, hardwareProperties: { udid: "00008120-000A1B2C", platform: "iOS" } }, { deviceProperties: { name: "Jesse iPhone", deviceType: "iPhone 16 Pro", osVersionNumber: "26.1" }, hardwareProperties: { udid: "00008120-000A1B2C", platform: "iOS" } }] } }) });
  expect(duplicatePhone.code).toBe(1);
  expect(duplicatePhone.json.unavailable).toEqual(["ios-phones"]);
  expect(duplicatePhone.stderr).not.toContain("Jesse");
}, 30000);

test("a malformed simulator list is unavailable instead of an empty success", async () => {
  const badSimulators = await runInventory({ simctl: JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{}] }, runtimes: [], devicetypes: [] }) });
  expect(badSimulators.code).toBe(1);
  expect(badSimulators.json.unavailable).toEqual(["ios-simulators"]);
  expect(badSimulators.json.simulators).toEqual([]);
  const arraySimulators = await runInventory({ simctl: JSON.stringify({ devices: [] }) });
  expect(arraySimulators.code).toBe(1);
  expect(arraySimulators.json.unavailable).toEqual(["ios-simulators"]);
  const duplicateSimulator = await runInventory({ simctl: JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{ name: "iPhone 17 Pro", udid: "SIM-UDID-1", state: "Shutdown", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }], "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [{ name: "iPhone 17 Pro", udid: "SIM-UDID-1", state: "Shutdown", deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }] } }) });
  expect(duplicateSimulator.code).toBe(1);
  expect(duplicateSimulator.json.unavailable).toEqual(["ios-simulators"]);
  expect(duplicateSimulator.json.simulators).toEqual([]);
}, 30000);

test("an adb listing that is denied, unrecognized or duplicated is unavailable", async () => {
  const denied = await runInventory({ adbDevices: "List of devices attached\nSECRETSERIAL123\tunauthorized usb:1-1\n" });
  expect(denied.code).toBe(1);
  expect(denied.json.unavailable).toEqual(["android"]);
  expect(denied.json.android).toEqual([]);
  expect(denied.stdout).not.toContain("SECRETSERIAL123");
  expect(denied.stderr).toContain("Unavailable: android");
  expect(denied.stderr).not.toContain("SECRETSERIAL123");
  const wrongHeader = await runInventory({ adbDevices: "adb server version (41) does not match this client\nSECRETSERIAL123\tdevice\n" });
  expect(wrongHeader.code).toBe(1);
  expect(wrongHeader.json.unavailable).toEqual(["android"]);
  const duplicate = await runInventory({ adbDevices: "List of devices attached\nSECRETSERIAL123\tdevice\nSECRETSERIAL123\tdevice\n" });
  expect(duplicate.code).toBe(1);
  expect(duplicate.json.unavailable).toEqual(["android"]);
  const unknownState = await runInventory({ adbDevices: "List of devices attached\nSECRETSERIAL123\tconnected\n" });
  expect(unknownState.code).toBe(1);
  expect(unknownState.json.unavailable).toEqual(["android"]);
}, 30000);

test("unavailable tools are reported and still exit non-zero", async () => {
  const missing = await runInventory({ xcrunOk: false, adbOk: false });
  expect(missing.code).toBe(1);
  expect(missing.json.unavailable).toEqual(["ios-simulators", "ios-phones", "android"]);
  expect(missing.json).toEqual({ simulators: [], phones: [], android: [], unavailable: ["ios-simulators", "ios-phones", "android"] });
}, 30000);
