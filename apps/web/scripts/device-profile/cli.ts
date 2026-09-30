import { readFile, readdir, rename, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { Cdp, activateTarget, connectCdp, consoleResult, endTracing, startTracing } from "./cdp";
import { defaults, probeProxy, proxyOptions, startProxy, assertOutsideWorktree, buildToolkit } from "./proxy";
import { acquireDeviceLock } from "./device-lock";
import { artifactName, integer, resultFailure, summarize, traceTotals, chromeCommandLineArgs, chromeCommandLineSnapshot, debugAppFrom, isEmulatorDevice, safeName, runId, CHROME_COMMAND_LINE, matrix, parseArgs, productionTarget, validResult, androidView, duplicateValues, parseAdbDevices, phoneView, probeInto, selectSimulator, simulatorView, type KnownSimulatorFacts, type Workload, type Result, type Plan, type TraceEvent } from "./model";

const args = process.argv.slice(2);
const command = args.shift();
if (!command || !["serve", "inventory", "ios-sim", "android", "summarize"].includes(command)) throw new Error("Usage: profile:device serve|inventory|ios-sim|android|summarize [options]");
const { flags, paths: summaryPaths } = parseArgs(command, args);
const numberFlag = (key: string, fallback: number, max = 2000) => {
  const n = integer(flags.get(key) ?? String(fallback), 1, max);
  if (n === null) throw new Error(`Invalid --${key}`);
  return n;
};
const adbPath = async () => {
  const path = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
  const sdkAdb = join(path, "platform-tools/adb");
  if (await Bun.file(sdkAdb).exists()) return sdkAdb;
  await output("which", ["adb"]);
  return "adb";
};
async function output(bin: string, values: string[], timeout = 30000) {
  const child = Bun.spawn([bin, ...values], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false, abandon: (error: Error) => void = () => {};
  const abandoned = new Promise<never>((_resolve, reject) => { abandon = reject; });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  const forced = setTimeout(() => { child.kill("SIGKILL"); abandon(new Error(`${bin} ${values[0]} did not exit within ${timeout + 10000}ms; the device may still hold this command`)); }, timeout + 10000);
  try {
    const [stdout, stderr, code] = await Promise.race([Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]), abandoned]);
    if (timedOut) throw new Error(`${bin} ${values[0]} timed out after ${timeout}ms`);
    if (code !== 0) throw new Error(`${bin} ${values[0]}: ${stderr.trim().slice(0, 400)}`);
    return stdout;
  } finally { clearTimeout(timer); clearTimeout(forced); }
}
const trustedIdentifiers = async (section: string) => {
  const parsed: unknown = JSON.parse(await output("xcrun", ["simctl", "list", section, "-j"]));
  const listed = (parsed as Record<string, unknown>)[section];
  if (!Array.isArray(listed)) throw new Error(`unexpected ${section} list shape`);
  return new Set(listed.map((item) => (item as { identifier?: unknown }).identifier).filter((id): id is string => typeof id === "string"));
};
async function inventory() {
  const publicView = flags.has("public");
  const unavailable: string[] = [];
  const report = (name: string, error: unknown) => console.error(publicView ? `Unavailable: ${name} (run without --public for the reason)` : `Unavailable: ${name}: ${String(error)}`);
  const simulators = await probeInto(unavailable, "ios-simulators", async () => {
    const parsed: unknown = JSON.parse(await output("xcrun", ["simctl", "list", "-j"]));
    const entries = (parsed as { devices?: unknown }).devices;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("unexpected simulator list shape");
    const known: KnownSimulatorFacts = { runtimes: await trustedIdentifiers("runtimes"), deviceTypes: await trustedIdentifiers("devicetypes") };
    const listed: { runtime: string; name: string; state: string; udid: string; deviceTypeIdentifier?: string }[] = [];
    for (const [runtime, devices] of Object.entries(entries as Record<string, unknown>)) {
      if (!Array.isArray(devices)) throw new Error("unexpected simulator list shape");
      for (const entry of devices) {
        const device = (entry ?? {}) as { name?: unknown; udid?: unknown; state?: unknown; deviceTypeIdentifier?: unknown };
        if (typeof device.name !== "string" || typeof device.udid !== "string" || typeof device.state !== "string" || (device.deviceTypeIdentifier !== undefined && typeof device.deviceTypeIdentifier !== "string")) throw new Error("unexpected simulator entry shape");
        listed.push({ runtime, name: device.name, state: device.state, udid: device.udid, ...typeof device.deviceTypeIdentifier === "string" ? { deviceTypeIdentifier: device.deviceTypeIdentifier } : {} });
      }
    }
    if (duplicateValues(listed.map((device) => device.udid)).length) throw new Error("simulator list repeats a device identifier");
    return listed.map((device) => simulatorView(device, publicView, known));
  }, [], report);
  const phones = await probeInto(unavailable, "ios-phones", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "home-devices-"));
    try {
      await output("xcrun", ["devicectl", "list", "devices", "--json-output", join(tmp, "devices.json")]);
      const parsed: unknown = JSON.parse(await readFile(join(tmp, "devices.json"), "utf8"));
      const listed = (parsed as { result?: { devices?: unknown } }).result?.devices;
      if (!Array.isArray(listed)) throw new Error("unexpected devicectl result shape");
      const listedRaw: { name?: string; platform: string; deviceType: string; osVersion: string; udid: string }[] = [];
      for (const entry of listed) {
        const device = (entry ?? {}) as { deviceProperties?: { name?: unknown; deviceType?: unknown; osVersionNumber?: unknown }; hardwareProperties?: { udid?: unknown; platform?: unknown; deviceType?: unknown } };
        const required = (value: unknown, field: string): string => { if (typeof value !== "string" || value === "") throw new Error(`physical device is missing ${field}`); return value; };
        const hardware = device.hardwareProperties ?? {};
        listedRaw.push({ name: typeof device.deviceProperties?.name === "string" ? device.deviceProperties.name : undefined, platform: required(hardware.platform, "its platform"), deviceType: required(device.deviceProperties?.deviceType ?? hardware.deviceType, "its device type"), osVersion: required(device.deviceProperties?.osVersionNumber, "its OS version"), udid: required(hardware.udid, "its identifier") });
      }
      if (duplicateValues(listedRaw.map((device) => device.udid)).length) throw new Error("physical device list repeats an identifier");
      return listedRaw.map((device) => phoneView(device, publicView));
    } finally { await rm(tmp, { recursive: true, force: true }); }
  }, [] as Record<string, string>[], report);
  const android = await probeInto(unavailable, "android", async () => {
    const adb = await adbPath();
    const entries = parseAdbDevices(await output(adb, ["devices", "-l"]));
    const notReady = entries.filter((entry) => entry.state !== "device");
    if (notReady.length) throw new Error(`${notReady.length} connected device(s) are not ready (${[...new Set(notReady.map((entry) => entry.state))].join(", ")}); enable USB debugging and accept the authorization prompt`);
    return await Promise.all(entries.map(async ({ serial }) => {
      const prop = async (key: string) => (await output(adb, ["-s", serial, "shell", "getprop", key])).trim();
      const [model, release, chrome] = await Promise.all([prop("ro.product.model"), prop("ro.build.version.release"), output(adb, ["-s", serial, "shell", "dumpsys", "package", "com.android.chrome"]).catch(() => "")]);
      if (!model || !release) throw new Error("device reported an empty model or OS version");
      return androidView({ model, release, chrome: chrome.match(/versionName=([^\s]+)/)?.[1] ?? "unavailable", ...publicView ? {} : { serial } }, publicView);
    }));
  }, [] as unknown[], report);
  console.log(JSON.stringify({ simulators, phones, android, unavailable }, null, 2));
  for (const device of simulators) console.log(`iOS ${[device.name ?? device.family, device.deviceTypeIdentifier ?? `${device.os} ${device.osVersion}`, device.state, device.udid].filter(Boolean).join(" ")}`);
  for (const device of phones) console.log(`iPhone ${[device.name ?? device.deviceType, device.platform, device.osVersion, device.udid].filter(Boolean).join(" ")}`);
  for (const device of android as { model?: string; family?: string; release: string; chrome: string; serial?: string }[]) console.log(`Android ${device.model ?? device.family} ${device.release} Chrome ${device.chrome}${device.serial ? ` ${device.serial}` : ""}`);
  if (unavailable.length) process.exitCode = 1;
}
async function awaitResult(since: number, base: string, label: string, workload: Workload, rows: number) {
  const deadline = Date.now() + 150000;
  const expected = artifactName(label, workload, ".json");
  while (Date.now() < deadline) {
    const status = await fetch(`${base}/__device-profile/status?since=${since}`, { signal: AbortSignal.timeout(3000) }).then((res) => res.json()) as { outDir?: string; files: string[] };
    const file = status.files.find((name) => name.endsWith(expected));
    if (file) {
      if (!status.outDir) throw new Error("Proxy did not report its output directory; restart it from this checkout");
      return { file, outDir: status.outDir };
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${workload} (${rows} rows); inspect browser badge or console`);
}
const repeated = <T>(entries: T[], repeat: number) => entries.flatMap((entry) => Array.from({ length: repeat }, () => entry));
async function ensureProxy(port: number) {
  const opts = { ...defaults(), port };
  const built = await buildToolkit();
  if (await probeProxy(port, built.toolkit) === "reuse") return { stop() {} };
  return startProxy(opts, built);
}
async function iosSim() {
  const name = flags.get("device"); if (!name) throw new Error("--device required");
  const port = numberFlag("port", 4199, 65535), rows = numberFlag("rows", 300), repeat = numberFlag("repeat", 1, 20);
  const entries = repeated(matrix(flags.get("workload") ?? "all", rows, false), repeat), label = safeName(flags.get("label") ?? "ios");
  const parsed = JSON.parse(await output("xcrun", ["simctl", "list", "devices", "available", "-j"])) as { devices?: Record<string, { name: string; udid: string; state: string }[]> };
  if (!parsed.devices || typeof parsed.devices !== "object" || Array.isArray(parsed.devices)) throw new Error("unexpected simulator list shape");
  const available: { runtime: string; name: string; udid: string; state: string }[] = [];
  for (const [runtime, listed] of Object.entries(parsed.devices)) {
    if (!Array.isArray(listed)) throw new Error("unexpected simulator list shape");
    for (const item of listed) available.push({ runtime, ...item });
  }
  const device = selectSimulator(available, name);
  const bootsHere = device.state !== "Booted";
  const release = await acquireDeviceLock(device.udid);
  let proxy: { stop(): void } | null = null, booted = false;
  try {
    proxy = await ensureProxy(port);
    const base = `http://localhost:${port}`;
    if (bootsHere) {
      try { await output("xcrun", ["simctl", "boot", device.udid], 60000); }
      catch (error) { throw new Error(`${String(error)}; if the simulator did start, shut it down with "xcrun simctl shutdown ${device.udid}"`); }
      booted = true;
    }
    await output("xcrun", ["simctl", "bootstatus", device.udid, "-b"], 180000);
    const failures: string[] = [];
    for (const [index, item] of entries.entries()) {
      try {
      const unique = runId(index, label, Date.now(), crypto.randomUUID().slice(0, 8));
      const since = Date.now() - 1000;
      const url = new URL(`${base}/__device-profile/run`);
      url.search = new URLSearchParams({ workload: item.workload, rows: String(item.rows), repeat: "1", label: unique }).toString();
      await output("xcrun", ["simctl", "openurl", device.udid, url.href]);
      const { file, outDir } = await awaitResult(since, base, unique, item.workload, item.rows);
      const parsed: unknown = JSON.parse(await readFile(resolve(outDir, file), "utf8"));
      if (!validResult(parsed)) throw new Error(`Invalid result file: ${file}`);
      const result = parsed;
      const failure = resultFailure(result);
      if (failure) throw new Error(failure);
      console.log(`Result: ${file}\n${summarize([result])}`);
      } catch (error) { const failure = `${item.workload} (${item.rows} rows): ${String(error)}`; failures.push(failure); console.error(`Failed: ${failure}`); }
    }
    if (failures.length) throw new Error(`Workload failures:\n${failures.join("\n")}`);
  } finally {
    void proxy?.stop();
    if (booted) await output("xcrun", ["simctl", "shutdown", device.udid]).catch((error) => { console.error(error); process.exitCode = 1; });
    await release().catch((error) => { console.error(`Releasing the simulator lock failed: ${String(error)}`); process.exitCode = 1; });
  }
}
async function freePort() { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }); const port = server.port; void server.stop(); if (!port) throw new Error("Failed to allocate CDP port"); return port; }
async function android() {
  const serial = flags.get("serial"); if (!serial) throw new Error("--serial required");
  const rows = numberFlag("rows", 300), repeat = numberFlag("repeat", 1, 20), port = numberFlag("port", 4199, 65535);
  const url = flags.get("url"), entries = repeated(matrix(flags.get("workload") ?? "all", rows, !!url), repeat), label = safeName(flags.get("label") ?? "android"), traceDir = flags.get("trace");
  if (url) productionTarget(url, entries[0]!.workload);
  if (traceDir) await assertOutsideWorktree(resolve(traceDir));
  const adb = await adbPath(), localPort = await freePort();
  const runAdb = (values: string[]) => output(adb, ["-s", serial, ...values]);
  const release = await acquireDeviceLock(serial);
  let proxy: { stop(): void } | null = null, browser: Cdp | null = null, forwardCreated = false, reverseCreated = false, chromeConfigured = false, chromeDebugApp: string | null = null, chromeCommandLine: string | null = null;
  try {
    if (!url) proxy = await ensureProxy(port);
    if (!url && !(await runAdb(["reverse", "--list"])).split("\n").some((line) => line.trim().endsWith(`tcp:${port} tcp:${port}`))) {
      try { await runAdb(["reverse", "--no-rebind", `tcp:${port}`, `tcp:${port}`]); reverseCreated = true; }
      catch (error) { console.error(`adb reverse failed (${String(error)}); check \`adb reverse --list\` and remove any tcp:${port} mapping this run left behind`); throw error; }
    }
    if (isEmulatorDevice(serial, await runAdb(["shell", "getprop", "ro.kernel.qemu"]).catch(() => ""))) {
      chromeCommandLine = await chromeCommandLineSnapshot(runAdb);
      chromeDebugApp = debugAppFrom(await runAdb(["shell", "dumpsys", "activity"]));
      chromeConfigured = true;
      await runAdb(["shell", "am", "set-debug-app", "--persistent", "com.android.chrome"]);
      await runAdb(chromeCommandLineArgs(Buffer.from(CHROME_COMMAND_LINE).toString("base64")));
      await runAdb(["shell", "pm", "grant", "com.android.chrome", "android.permission.POST_NOTIFICATIONS"]).catch((error) => console.error(`Granting Chrome the notification permission failed: ${String(error)}`));
    }
    await runAdb(["shell", "am", "force-stop", "com.android.chrome"]);
    await runAdb(["shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main"]);
    try { await runAdb(["forward", "--no-rebind", `tcp:${localPort}`, "localabstract:chrome_devtools_remote"]); forwardCreated = true; }
    catch (error) { console.error(`adb forward failed (${String(error)}); check \`adb forward --list\` and remove any tcp:${localPort} mapping this run left behind`); throw error; }
    for (let attempt = 0; attempt < 30 && !browser; attempt++) {
      try { browser = await connectCdp(localPort); }
      catch (error) { if (attempt === 29) throw new Error(`Chrome CDP unavailable after 30 attempts: ${String(error)}`); await Bun.sleep(1000); }
    }
    if (!browser) throw new Error("Chrome CDP unavailable");
    const failures: string[] = [];
    for (const [index, item] of entries.entries()) {
      try {
      const unique = runId(index, label, Date.now(), crypto.randomUUID().slice(0, 8)), since = Date.now() - 1000;
      const { targetId } = await browser.command("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      try {
        const { sessionId } = await browser.command("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
        await activateTarget(browser, targetId, sessionId);
        const session = sessionId;
        const events: TraceEvent[] = [];
        const offTrace = browser.on("Tracing.dataCollected", (data) => {
          if (Array.isArray(data.value)) events.push(...data.value);
        });
        let offConsole = () => {}, resultTimer: ReturnType<typeof setTimeout> | undefined;
        const resultFromConsole = new Promise<Result>((done, reject) => {
          if (!url) return;
          resultTimer = setTimeout(() => reject(new Error("No console result within 150s")), 150000);
          offConsole = browser!.on("Runtime.consoleAPICalled", (data) => {
            const result = consoleResult(data);
            if (result) { clearTimeout(resultTimer); offConsole(); done(result); }
          }, session);
        });
        try {
          await browser.command("Runtime.enable", {}, session);
          await browser.command("Page.enable", {}, session);
          if (url) {
            const plan: Plan = { workload: item.workload, rows: item.rows, repeat: 1, label: unique, duration: 10 };
            const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "harness.ts")], target: "browser", minify: true });
            if (!build.success) throw new Error(build.logs.map(String).join("\n"));
            const source = `sessionStorage.setItem("home:device-profile:plan",${JSON.stringify(JSON.stringify(plan))});\n${await build.outputs[0]!.text()}`;
            await browser.command("Page.addScriptToEvaluateOnNewDocument", { source }, session);
          }
          if (traceDir) await startTracing(browser);
          let result: Result, resultOutDir: string | null = null, traceLoss = false;
          try {
            const target = url ? productionTarget(url, item.workload) : `http://localhost:${port}/__device-profile/run?${new URLSearchParams({ workload: item.workload, rows: String(item.rows), repeat: "1", label: unique })}`;
            const navigation = await browser.command("Page.navigate", { url: target }, session, 30000);
            if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
            if (url) { result = await resultFromConsole; const failure = resultFailure(result); if (failure) throw new Error(failure); }
            else {
              const found = await awaitResult(since, `http://127.0.0.1:${port}`, unique, item.workload, item.rows);
              resultOutDir = found.outDir;
              const parsed: unknown = JSON.parse(await readFile(resolve(found.outDir, found.file), "utf8"));
              if (!validResult(parsed)) throw new Error(`Invalid result file: ${found.file}`);
              result = parsed;
              const failure = resultFailure(result);
              if (failure) throw new Error(failure);
            }
          } finally { if (traceDir) traceLoss = (await endTracing(browser, 60000)).dataLossOccurred; }
          if (traceDir) {
            const path = resolve(traceDir, artifactName(unique, item.workload, ".trace.json"));
            await writeFile(path, JSON.stringify({ traceEvents: events }));
            if (traceLoss) { result.traceError = "Chrome reported trace data loss"; console.error("Chrome reported trace data loss; totals omitted"); }
            else {
              const totals = traceTotals(events, result.runs.length, item.workload === "replace-state-probe" ? result.runs.length : 0);
              result.runs.forEach((run, index) => { if (totals.runs[index]) run.trace = totals.runs[index]!; });
              if (totals.error) { result.traceError = totals.error; console.error(`Trace totals unavailable: ${totals.error}`); }
            }
            for (const directory of [traceDir, resultOutDir]) {
              if (!directory) continue;
              const traced = resolve(directory, artifactName(unique, item.workload, "-traced.json"));
              const tracedTemporary = `${traced}.${crypto.randomUUID()}.writing`;
              try { await writeFile(tracedTemporary, JSON.stringify(result, null, 2)); await rename(tracedTemporary, traced); }
              finally { await rm(tracedTemporary, { force: true }); }
            }
            console.log(`Trace: ${path}`);
          }
          console.log(summarize([result]));
          if (result.error) throw new Error(result.error);
        } finally { offConsole(); offTrace(); clearTimeout(resultTimer); }
      } finally { await browser.command("Target.closeTarget", { targetId }).catch(() => {}); }
      } catch (error) { const failure = `${item.workload}${url ? "" : ` (${item.rows} rows)`}: ${String(error)}`; failures.push(failure); console.error(`Failed: ${failure}`); }
    }
    if (failures.length) throw new Error(`Workload failures:\n${failures.join("\n")}`);
  } finally {
    browser?.close();
    if (chromeConfigured) {
      await runAdb(chromeCommandLineArgs(chromeCommandLine)).catch((error) => { console.error(`Restoring Chrome's command-line file failed: ${String(error)}`); process.exitCode = 1; });
      if (chromeDebugApp) await runAdb(["shell", "am", "set-debug-app", "--persistent", chromeDebugApp]).catch((error) => { console.error(`Restoring the debug app failed: ${String(error)}`); process.exitCode = 1; });
      else await runAdb(["shell", "am", "clear-debug-app"]).catch((error) => { console.error(`Clearing the debug app failed: ${String(error)}`); process.exitCode = 1; });
    }
    if (forwardCreated) await runAdb(["forward", "--remove", `tcp:${localPort}`]).catch((error) => { console.error(`Removing the adb port forward failed: ${String(error)}`); process.exitCode = 1; });
    if (reverseCreated) await runAdb(["reverse", "--remove", `tcp:${port}`]).catch((error) => { console.error(`Removing the adb port reverse failed: ${String(error)}`); process.exitCode = 1; });
    void proxy?.stop();
    await release().catch((error) => { console.error(`Releasing the device lock failed: ${String(error)}`); process.exitCode = 1; });
  }
}
async function summary() {
  const paths = summaryPaths;
  if (!paths.length) throw new Error("summarize requires directory or JSON files");
  const files = (await Promise.all(paths.map(async (path) => {
    const file = Bun.file(path);
    if (await file.exists()) return [path];
    return (await readdir(path)).filter((name) => name.endsWith(".json") && !name.endsWith(".trace.json")).map((name) => join(path, name));
  }))).flat();
  const parsed = await Promise.all(files.map(async (file) => { try { const value: unknown = JSON.parse(await readFile(file, "utf8")); return validResult(value) ? value : file; } catch { return file; } }));
  const invalid = parsed.filter((item): item is string => typeof item === "string");
  console.log(summarize(parsed.filter((item): item is Result => typeof item !== "string"), flags.has("markdown")));
  if (invalid.length) { console.error(`Not a device-profile result: ${invalid.join(", ")}`); process.exitCode = 1; }
}
if (command === "serve") await startProxy(proxyOptions(flags));
else if (command === "inventory") await inventory();
else if (command === "ios-sim") await iosSim();
else if (command === "android") await android();
else if (command === "summarize") await summary();
else throw new Error("Usage: profile:device serve|inventory|ios-sim|android|summarize [options]");
