import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { acquireDeviceLock } from "../../apps/web/scripts/device-profile/device-lock";
import { activateTarget, connectCdp } from "../../apps/web/scripts/device-profile/cdp";
import { CHROME_COMMAND_LINE, chromeCommandLineArgs, chromeCommandLineSnapshot, debugAppFrom, isEmulatorDevice, parseAdbDevices, safeName } from "../../apps/web/scripts/device-profile/model";
import { activateRecordedPage, assertFixtureTargets, validateChromiumViewport, cleanupSteps, dndMode, loopbackPort, selectAndroidDevice, targetFlags } from "./clip-core.mjs";
import { alive, browser, exists, run, save, stopChild, until, type ClipState } from "./clip-runtime";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
const defaults = { spawn, acquireDeviceLock, connectCdp, browser, exists, run, save, stopChild, until, readFile, rm, freePort, fetch, now: Date.now };

export interface ClipTarget {
  start(): Promise<void>;
  stop(): Promise<void>;
  cleanup(): Promise<void>;
  monitor(): Promise<void>;
}
export function localTarget(state: ClipState, directory: string, recover = false, dependencies: Partial<typeof defaults> = {}): ClipTarget {
  const { spawn, acquireDeviceLock, connectCdp, browser, exists, run, save, stopChild, until, readFile, rm, freePort, fetch, now } = { ...defaults, ...dependencies };
  if (state.target === "ios") return {
    async start() { throw new Error("iOS Simulator clips are not supported yet; see https://github.com/jessepollak/home/issues/1927"); },
    async stop() {}, async cleanup() {}, async monitor() {},
  };
  let attached = recover && Boolean(state.browserAttached || state.cdpPort || state.recorderPid), recording = recover && Boolean(state.recordingIntent || state.deviceRecorderPid || state.recorderPid);
  const ab = (args: string[]) => browser(targetFlags(state), args);
  const closeBrowser = () => browser(["--session", state.session], ["close"]);
  const persist = () => save(join(directory, "state.json"), state);
  async function viewport() {
    state.css = JSON.parse(await ab(["eval", "({width:innerWidth,height:innerHeight,outerWidth,dpr:devicePixelRatio})"]));
    if (!state.css || !Number.isFinite(state.css.width) || !Number.isFinite(state.css.height)) throw new Error("Browser did not report a CSS viewport");
  }
  if (state.target === "chromium") return {
    async start() {
      if (process.env.AGENT_BROWSER_HEADED === "true") throw new Error("Chromium clips require a headless browser, not a headed window");
      attached = true; state.browserAttached = true; await persist();
      await ab(["set", "viewport", String(state.viewport.width), String(state.viewport.height), "2"]);
      if (state.url) await ab(["open", state.url]);
      await viewport();
      state.recorderPid = JSON.parse(await ab(["session", "info", "--json"])).data?.pid;
      validateChromiumViewport(state.css!);
      if (state.css!.width !== state.viewport.width || state.css!.height !== state.viewport.height) throw new Error("Chromium did not apply the requested viewport");
      state.recordingIntent = true; await persist();
      recording = true;
      await ab(["record", "start", state.raw]);
      await ab(["eval", `(async () => { const marker = document.createElement("div"); marker.id = "home-clip-calibration"; marker.style.cssText = "all:initial;position:fixed;left:0;top:0;width:100vw;height:8px;background:rgb(17,233,71);z-index:2147483647;pointer-events:none"; document.documentElement.append(marker); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise(resolve => setTimeout(resolve, 600)); marker.remove(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()`]);
      await persist();
    },
    async monitor() {},
    async stop() { if (recording) { await ab(["record", "stop"]); recording = false; } },
    async cleanup() {
      await cleanupSteps([
        ["recorder", async () => { if (recording && !recover) { await ab(["record", "stop"]); recording = false; } }],
        ["browser", async () => { if (attached) await closeBrowser(); }],
      ]);
    },
  };
  let adb = state.adbPath ?? "adb", serial = recover ? state.serial ?? "" : "", release: (() => Promise<void>) | undefined;
  let forward = recover && Boolean(state.forwardCreated), reverse = recover && Boolean(state.reversePort), configured = recover && Boolean(state.chromeConfigured);
  let previousCommand: string | null = state.previousChromeCommand ?? null, previousDebug: string | null = state.previousDebugApp ?? null;
  let recorder: ChildProcess | undefined;
  let previousDnd: string | undefined = state.previousDnd;
  let recorderError = "", recorderFailed = false;
  let guardError: Error | undefined;
  let guardCdp: Awaited<ReturnType<typeof connectCdp>> | undefined;
  let guardSession: string | undefined, guardEnforced = false;
  async function fixtureGuard() {
    if (state.emulator) return;
    if (guardError) throw guardError;
    const cdp = guardCdp ?? await connectCdp(state.cdpPort!);
    try {
      const { targetInfos } = await cdp.command("Target.getTargets") as { targetInfos: { targetId: string; type: string; url: string }[] };
      assertFixtureTargets(targetInfos, state.url, state.preexistingTargets, state.ownTarget);
      if (guardSession) {
        const result = await cdp.command("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, guardSession) as { result?: { value?: unknown } };
        if (result.result?.value !== "visible") throw new Error("Physical Android fixture is no longer foreground; recording discarded");
      } else {
        const { sessionId } = await cdp.command("Target.attachToTarget", { targetId: state.ownTarget, flatten: true }) as { sessionId: string };
        try {
          const result = await cdp.command("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, sessionId) as { result?: { value?: unknown } };
          if (result.result?.value !== "visible") throw new Error("Physical Android fixture is no longer foreground; recording discarded");
        } finally { await cdp.command("Target.detachFromTarget", { sessionId }); }
      }
      if (guardError) throw guardError;
      guardEnforced = true;
    } finally { if (!guardCdp) cdp.close(); }
  }
  async function recorderCommand() {
    if (!state.deviceRecorderPid) {
      const pid = await runAdb(["shell", "cat", devicePidFile]).catch(() => "");
      if (/^[1-9]\d*$/.test(pid)) { state.deviceRecorderPid = Number(pid); await persist(); }
    }
    if (!state.deviceRecorderPid) return "";
    return runAdb(["shell", "cat", `/proc/${state.deviceRecorderPid}/cmdline`]).catch(() => "");
  }
  const deviceRaw = `/sdcard/home-clip-${state.session}.mp4`;
  const devicePidFile = `/data/local/tmp/home-clip-${state.session}.pid`;
  const runAdb = (args: string[]) => run(adb, ["-s", serial, ...args]);
  async function stopRecorder() {
    if (!recording) return;
    const command = await recorderCommand();
    if (command.includes("screenrecord") && command.includes(deviceRaw)) {
      await runAdb(["shell", "kill", "-INT", String(state.deviceRecorderPid)]);
      await until(async () => !(await recorderCommand()).includes(deviceRaw), 15000);
    }
    recording = false;
  }
  return {
    async start() {
      const sdkAdb = join(process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk"), "platform-tools/adb");
      if (await exists(sdkAdb)) adb = sdkAdb;
      state.adbPath = adb;
      const listed = parseAdbDevices(await run(adb, ["devices", "-l"]));
      for (const device of listed.filter((device) => device.state !== "device")) console.warn(`Android device ${device.serial} is ${device.state}; authorize or reconnect it before selecting`);
      const entries = listed.filter((device) => device.state === "device");
      const devices = await Promise.all(entries.map(async ({ serial: id }) => ({
        serial: id,
        model: await run(adb, ["-s", id, "shell", "getprop", "ro.product.model"]),
        avd: id.startsWith("emulator-") ? (await run(adb, ["-s", id, "emu", "avd", "name"])).split("\n")[0] : "",
      })));
      const selected = selectAndroidDevice(devices, state);
      serial = selected.serial;
      state.serial = serial; state.ownerPid = process.pid;
      await persist();
      release = await acquireDeviceLock(serial);
      state.model = selected.model;
      state.emulator = isEmulatorDevice(serial, await runAdb(["shell", "getprop", "ro.kernel.qemu"]));
      state.chromeVersion = (await runAdb(["shell", "dumpsys", "package", "com.android.chrome"])).match(/versionName=([^\s]+)/)?.[1];
      if (!state.chromeVersion) throw new Error("Chrome is not installed on the selected device");
      const port = loopbackPort(state.url);
      if (!state.emulator) {
        if (!port || !state.url?.startsWith("http://")) throw new Error("Physical Android recordings require a localhost HTTP fixture URL; live or personal sessions are not allowed");
        previousDnd = await runAdb(["shell", "settings", "get", "global", "zen_mode"]);
        dndMode(previousDnd);
        state.previousDnd = previousDnd;
        await persist();
        await runAdb(["shell", "cmd", "notification", "set_dnd", "none"]);
        if (await runAdb(["shell", "settings", "get", "global", "zen_mode"]) !== "2") throw new Error("Could not silence Android notifications; refusing full-screen recording");
      }
      if (port) {
        const mappings = (await runAdb(["reverse", "--list"])).trim().split("\n").filter(Boolean);
        const existing = mappings.find((line) => line.split(/\s+/)[1] === `tcp:${port}`);
        if (existing && !existing.endsWith(`tcp:${port} tcp:${port}`)) throw new Error(`Android reverse port ${port} is already mapped elsewhere`);
        if (!existing) { reverse = true; state.reversePort = port; await persist(); await runAdb(["reverse", "--no-rebind", `tcp:${port}`, `tcp:${port}`]); }
      }
      if (state.emulator) {
        previousCommand = await chromeCommandLineSnapshot(runAdb);
        previousDebug = debugAppFrom(await runAdb(["shell", "dumpsys", "activity"]));
        configured = true;
        state.chromeConfigured = true; state.previousChromeCommand = previousCommand; state.previousDebugApp = previousDebug;
        await persist();
        await runAdb(["shell", "am", "set-debug-app", "--persistent", "com.android.chrome"]);
        await runAdb(chromeCommandLineArgs(Buffer.from(CHROME_COMMAND_LINE).toString("base64")));
      }
      if (state.emulator) await runAdb(["shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main"]);
      state.cdpPort = await freePort();
      forward = true; state.forwardCreated = true;
      await persist();
      await runAdb(["forward", "--no-rebind", `tcp:${state.cdpPort}`, "localabstract:chrome_devtools_remote"]);
      await until(async () => fetch(`http://127.0.0.1:${state.cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) }).then((response) => response.ok).catch(() => false));
      const cdp = await connectCdp(state.cdpPort);
      try {
        const { targetInfos } = await cdp.command("Target.getTargets") as { targetInfos: { targetId: string; type: string }[] };
        const preexisting = new Set(targetInfos.map((target) => target.targetId));
        let snapshotting = true;
        const startupBlanks = new Set<string>();
        if (!state.emulator) {
          guardCdp = cdp;
          const watch = (params: Record<string, unknown>) => {
            const target = params.targetInfo as { targetId: string; type: string; url: string };
            if (!target) return;
            if (snapshotting) { preexisting.add(target.targetId); return; }
            if (target.type !== "page" || preexisting.has(target.targetId)) return;
            if (!guardEnforced && (target.url === "" || target.url === "about:blank")) { startupBlanks.add(target.targetId); return; }
            try { if (new URL(target.url).origin === new URL(state.url!).origin) return; } catch {}
            guardError = new Error("Physical Android page left the fixture origin; recording discarded");
          };
          cdp.on("Target.targetCreated", watch); cdp.on("Target.targetInfoChanged", watch);
          await cdp.command("Target.setDiscoverTargets", { discover: true });
        }
        snapshotting = false;
        state.preexistingTargets = [...preexisting];
        console.log(`Grandfathered ${state.preexistingTargets.length} pre-existing Android targets`);
        attached = true; state.browserAttached = true; await persist();
        await ab(["open", state.url ?? "about:blank"]);
        const marker = crypto.randomUUID();
        await ab(["eval", `globalThis["home:clip:session"] = ${JSON.stringify(marker)}`]);
        state.ownTarget = await activateRecordedPage(cdp, marker, activateTarget, state.preexistingTargets);
        await persist();
        if (!state.emulator) {
          if ([...startupBlanks].some((id) => id !== state.ownTarget)) throw new Error("Physical Android new page left the fixture origin; recording discarded");
          const { sessionId } = await cdp.command("Target.attachToTarget", { targetId: state.ownTarget, flatten: true }) as { sessionId: string };
          guardSession = sessionId;
          await cdp.command("Runtime.enable", {}, sessionId);
          cdp.on("Runtime.bindingCalled", (params) => {
            if (guardEnforced && params.name === "homeClipVisibility" && params.payload !== "visible") guardError = new Error("Physical Android fixture is no longer foreground; recording discarded");
          }, sessionId);
          await cdp.command("Runtime.addBinding", { name: "homeClipVisibility" }, sessionId);
          const visibilityScript = "document.addEventListener('visibilitychange', () => homeClipVisibility(document.visibilityState))";
          await cdp.command("Page.addScriptToEvaluateOnNewDocument", { source: visibilityScript }, sessionId);
          await cdp.command("Runtime.evaluate", { expression: visibilityScript }, sessionId);
        }
      } finally { if (!guardCdp) cdp.close(); }
      await viewport();
      await fixtureGuard();
      await runAdb(["shell", "rm", "-f", devicePidFile, deviceRaw]);
      state.recordingIntent = true; state.recordingAt = now(); recording = true; await persist();
      recorder = spawn(adb, ["-s", serial, "shell", "sh", "-c", `'echo $$ > ${devicePidFile}; exec screenrecord --time-limit 180 ${deviceRaw}'`], { stdio: ["ignore", "ignore", "pipe"] });
      recorder.stderr?.on("data", (data) => { recorderError += data; });
      recorder.on("error", (error) => { recorderFailed = true; recorderError += String(error); });
      state.recorderPid = recorder.pid;
      recording = true;
      await until(async () => {
        if (recorderFailed || recorder!.exitCode !== null || recorder!.signalCode !== null) throw new Error(`Android screenrecord failed: ${recorderError}`);
        const pid = await runAdb(["shell", "cat", devicePidFile]).catch(() => "");
        if (!/^[1-9]\d*$/.test(pid)) return false;
        state.deviceRecorderPid = Number(pid);
        const command = await recorderCommand();
        return command.includes("screenrecord") && command.includes(deviceRaw);
      });
      await persist();
    },
    async monitor() {
      await fixtureGuard();
      const command = await recorderCommand();
      if (recorderFailed || !recorder || recorder.exitCode !== null || recorder.signalCode !== null || !command.includes("screenrecord") || !command.includes(deviceRaw)) throw new Error(`Android screenrecord ended early; recording discarded: ${recorderError}`);
    },
    async stop() {
      await fixtureGuard();
      if (recorderFailed || !recorder || recorder.exitCode !== null || recorder.signalCode !== null) throw new Error(`Android screenrecord ended early; recording discarded: ${recorderError}`);
      const command = await recorderCommand();
      if (!command.includes("screenrecord") || !command.includes(deviceRaw)) throw new Error("Android screenrecord ended early; recording discarded");
      await stopRecorder();
      await fixtureGuard();
      await runAdb(["pull", deviceRaw, state.raw]);
    },
    async cleanup() {
      if (recover && serial) {
        const lock = join(tmpdir(), `home-device-profile-${safeName(serial)}.lock`);
        const owner = Number(await readFile(lock, "utf8").catch(() => ""));
        if (owner === state.ownerPid && !alive(owner)) await rm(lock, { force: true });
        release = await acquireDeviceLock(serial);
      }
      await cleanupSteps([
        ["recorder", stopRecorder],
        ["recorder process", async () => { if (recorder) await stopChild(recorder); }],
        ["fixture tab", async () => {
          guardCdp?.close(); guardCdp = undefined;
          if (!state.ownTarget || !state.cdpPort) return;
          const mapping = `${serial} tcp:${state.cdpPort} localabstract:chrome_devtools_remote`;
          if (!(await runAdb(["forward", "--list"])).split("\n").some((line) => line.trim() === mapping)) return;
          const cdp = await connectCdp(state.cdpPort).catch((error) => {
            const refused = (error: unknown): boolean => {
              if (!error || typeof error !== "object") return false;
              if ("code" in error && ["ECONNREFUSED", "ConnectionRefused"].includes(String(error.code))) return true;
              return "cause" in error && refused(error.cause);
            };
            if (refused(error)) return undefined;
            throw error;
          });
          if (!cdp) return;
          try {
            const { targetInfos } = await cdp.command("Target.getTargets") as { targetInfos: { targetId: string }[] };
            if (targetInfos.some((target) => target.targetId === state.ownTarget)) await cdp.command("Target.closeTarget", { targetId: state.ownTarget });
          } finally { cdp.close(); }
        }],
        ["browser", async () => { if (attached) await closeBrowser(); }],
        ["Chrome command line", async () => { if (configured) await runAdb(chromeCommandLineArgs(previousCommand)); }],
        ["Chrome debug app", async () => { if (configured) await runAdb(previousDebug ? ["shell", "am", "set-debug-app", "--persistent", previousDebug] : ["shell", "am", "clear-debug-app"]); }],
        ["adb forward", async () => {
          if (forward && (await runAdb(["forward", "--list"])).split("\n").some((line) => line.trim() === `${serial} tcp:${state.cdpPort} localabstract:chrome_devtools_remote`)) await runAdb(["forward", "--remove", `tcp:${state.cdpPort}`]);
        }],
        ["adb reverse", async () => {
          if (reverse && (await runAdb(["reverse", "--list"])).split("\n").some((line) => line.trim().split(/\s+/).slice(1).join(" ") === `tcp:${state.reversePort} tcp:${state.reversePort}`)) await runAdb(["reverse", "--remove", `tcp:${state.reversePort}`]);
        }],
        ["device files", async () => { if (serial && release) await runAdb(["shell", "rm", "-f", deviceRaw, devicePidFile]); }],
        ["Do Not Disturb", async () => {
          if (previousDnd !== undefined) {
            await runAdb(["shell", "cmd", "notification", "set_dnd", dndMode(previousDnd)]);
            if (await runAdb(["shell", "settings", "get", "global", "zen_mode"]) !== previousDnd) throw new Error("Android Do Not Disturb state was not restored");
          }
        }],
        ["device lock", async () => { await release?.(); }],
      ]);
    },
  };
}
