import { test, expect } from "bun:test";
import { EventEmitter } from "node:events";
import { spawnSync, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localTarget } from "./clip-targets";
import { remoteCommand, remoteTarget, sshArgs } from "./clip-remote";
import { CommandError, load, privateDirectory, removeSession, save, sessionDirectory, workerAlive, workerIdentity, type ClipState } from "./clip-runtime";

const stateFor = (target: ClipState["target"] = "android"): ClipState => ({ session: "resource-test", target, viewport: { width: 390, height: 844 }, raw: "/tmp/raw.mp4", url: "http://127.0.0.1:3199/home", createdAt: 1000, maxAge: 600, workerNonce: "resource-nonce" });
const immediate = async (check: () => Promise<boolean>) => { if (!await check()) throw new Error("stubbed timeout"); };
function child() {
  return Object.assign(new EventEmitter(), { pid: 999999, exitCode: null, signalCode: null, stderr: new EventEmitter() }) as unknown as ChildProcess;
}

function recoveredAndroid(command = "screenrecord\0--time-limit\0" + "180\0/sdcard/home-clip-resource-test.mp4") {
  const state = { ...stateFor(), serial: "device-test", ownerPid: 999999, adbPath: "adb-test", emulator: false, browserAttached: true, recordingIntent: true, deviceRecorderPid: 123, cdpPort: 9222, forwardCreated: true, reversePort: 3199, previousDnd: "1", chromeConfigured: true, previousChromeCommand: null, previousDebugApp: null };
  const calls: string[] = [];
  let current = command;
  const target = localTarget(state, "/private-state", true, {
    readFile: (async () => "999999") as typeof import("node:fs/promises").readFile,
    rm: async () => { calls.push("stale lock"); },
    acquireDeviceLock: async () => { calls.push("acquire lock"); return async () => { calls.push("release lock"); }; },
    save: async () => {}, until: immediate,
    browser: async (_flags, args) => { calls.push(`browser ${args.join(" ")}`); return ""; },
    run: async (_file, args) => {
      const command = args.slice(2).join(" "); calls.push(command);
      if (command === "shell cat /proc/123/cmdline") return current;
      if (command === "shell kill -INT 123") current = "";
      if (command === "forward --list") return "device-test tcp:9222 localabstract:chrome_devtools_remote";
      if (command === "reverse --list") return "UsbFfs tcp:3199 tcp:3199";
      if (command === "shell settings get global zen_mode") return "1";
      return "";
    },
  });
  return { target, state, calls };
}

test("Android recovery performs actual cleanup in order and restores DND before releasing its lock", async () => {
  const { target, calls } = recoveredAndroid();
  await target.cleanup();
  expect(calls).toEqual([
    "stale lock", "acquire lock", "shell cat /proc/123/cmdline", "shell kill -INT 123", "shell cat /proc/123/cmdline", "browser close",
    "shell rm -f /data/local/tmp/chrome-command-line", "shell am clear-debug-app", "forward --list", "forward --remove tcp:9222", "reverse --list", "reverse --remove tcp:3199",
    "shell rm -f /sdcard/home-clip-resource-test.mp4 /data/local/tmp/home-clip-resource-test.pid", "shell cmd notification set_dnd priority", "shell settings get global zen_mode", "release lock",
  ]);
});

test("Android recovery never signals a reused recorder pid", async () => {
  const { target, calls } = recoveredAndroid("unrelated-process");
  await target.cleanup();
  expect(calls.some((call) => call.startsWith("shell kill"))).toBe(false);
  expect(calls.at(-1)).toBe("release lock");
});

test("Android cleanup attempts DND restoration and lock release after a browser failure", async () => {
  const state = { ...stateFor(), serial: "device-test", cdpPort: 9222, browserAttached: true, previousDnd: "3" };
  const calls: string[] = [];
  const target = localTarget(state, "/private-state", true, {
    readFile: (async () => "") as typeof import("node:fs/promises").readFile,
    acquireDeviceLock: async () => async () => { calls.push("release"); },
    browser: async () => { throw new Error("browser failure"); },
    run: async (_file, args) => { calls.push(args.slice(2).join(" ")); return args.includes("zen_mode") ? "3" : ""; },
  });
  await expect(target.cleanup()).rejects.toThrow("browser failure");
  expect(calls.slice(-3)).toEqual(["shell cmd notification set_dnd alarms", "shell settings get global zen_mode", "release"]);
});

test("partial Chromium start persists daemon intent before creating a browser and recovery closes it", async () => {
  const state = stateFor("chromium");
  const calls: string[] = [];
  const deps = {
    save: async (_path: string, value: unknown) => { calls.push(`persist ${(value as ClipState).browserAttached}`); },
    browser: async (_flags: string[], args: string[]) => { calls.push(args[0]); if (args[0] === "set") throw new Error("start failure"); return ""; },
  };
  await expect(localTarget(state, "/private-state", false, deps).start()).rejects.toThrow("start failure");
  await localTarget(state, "/private-state", true, deps).cleanup();
  expect(calls).toEqual(["persist true", "set", "close"]);
});

function androidStart(options: { discoveryAlias?: boolean; transition?: string; extraBlank?: boolean } = {}) {
  const state = stateFor();
  const calls: string[] = [];
  const recorder = child();
  let recorderCommand = "screenrecord /sdcard/home-clip-resource-test.mp4";
  let targets = [{ type: "page", targetId: "old", url: "https://example.com" }];
  let visibility = "visible";
  const listeners = new Map<string, (params: Record<string, unknown>) => void>();
  const emitTarget = (method: string, targetId: string, url: string) => listeners.get(method)?.({ targetInfo: { type: "page", targetId, url } });
  const deps = {
    now: () => 1000,
    exists: async () => false,
    freePort: async () => 9222,
    acquireDeviceLock: async () => async () => { calls.push("release"); },
    save: async (_path: string, value: unknown) => { const s = value as ClipState; calls.push(`persist ${Boolean(s.reversePort)} ${Boolean(s.forwardCreated)} ${Boolean(s.recordingIntent)}`); },
    until: immediate,
    fetch: (async (url: string) => ({ ok: true, json: async () => url.endsWith("/list") ? targets : {} })) as unknown as typeof fetch,
    connectCdp: async () => ({ command: async (method: string, params: { expression?: string; targetId?: string } = {}, session?: string) => {
      calls.push(`cdp ${method} ${params.targetId ?? session ?? ""}`);
      if (method === "Target.getTargets") return { targetInfos: targets };
      if (method === "Target.attachToTarget") return { sessionId: params.targetId };
      if (method === "Target.setDiscoverTargets" && options.discoveryAlias) emitTarget("Target.targetCreated", "old-alias", "https://example.com");
      if (method === "Runtime.evaluate") return { result: { value: params.expression === "document.visibilityState" ? visibility : true } };
      return {};
    }, on(method: string, listener: (params: Record<string, unknown>) => void) { listeners.set(method, listener); }, close() {} }) as never,
    browser: async (_flags: string[], args: string[]) => {
      calls.push(`browser ${args[0]}`);
      if (args[0] === "open") {
        emitTarget("Target.targetCreated", "fixture", options.transition ?? "about:blank");
        if (options.extraBlank) emitTarget("Target.targetCreated", "unexpected", "about:blank");
        targets.push({ type: "page", targetId: "fixture", url: state.url! });
        emitTarget("Target.targetInfoChanged", "fixture", state.url!);
      }
      return args[0] === "eval" && args[1].startsWith("({") ? JSON.stringify({ width: 412, height: 811 }) : "";
    },
    spawn: (() => { calls.push("spawn screenrecord"); return recorder; }) as typeof import("node:child_process").spawn,
    stopChild: async () => { calls.push("stop recorder process"); },
    run: async (_file: string, args: string[]) => {
      const command = args.join(" "); calls.push(command);
      if (command === "devices -l") return "List of devices attached\ndevice-test device model:Pixel\n";
      if (command.includes("ro.product.model")) return "Pixel";
      if (command.includes("ro.kernel.qemu")) return "0";
      if (command.includes("dumpsys package")) return "versionName=123";
      if (command.includes("settings get global zen_mode")) return calls.findLast((call) => call.includes("set_dnd"))?.includes("none") ? "2" : "1";
      if (command.endsWith("cat /data/local/tmp/home-clip-resource-test.pid")) return "123";
      if (command.endsWith("cat /proc/123/cmdline")) return recorderCommand;
      if (command.endsWith("kill -INT 123")) recorderCommand = "";
      return "";
    },
  };
  return { state, calls, recorder, target: localTarget(state, "/private-state", false, deps), offOrigin: () => { targets = [{ type: "page", targetId: "fixture", url: "https://example.com" }]; }, hide: () => { visibility = "hidden"; }, newOffOrigin: () => { targets.push({ type: "page", targetId: "new", url: "https://example.com" }); }, reusePid: () => { recorderCommand = "other-process"; },
    eventOffOrigin: () => emitTarget("Target.targetInfoChanged", "fixture", "about:blank"),
    eventNewOffOrigin: () => emitTarget("Target.targetCreated", "new", "about:blank"),
    eventHide: () => listeners.get("Runtime.bindingCalled")?.({ name: "homeClipVisibility", payload: "hidden" }),
  };
}

test("physical startup snapshots discovery-only targets before opening and permits only its own blank transition", async () => {
  const { target, state, calls } = androidStart({ discoveryAlias: true });
  await target.start(); await target.monitor(); await target.cleanup();
  expect(state.preexistingTargets).toEqual(["old", "old-alias"]);
  expect(calls.indexOf("cdp Target.setDiscoverTargets ")).toBeLessThan(calls.indexOf("browser open"));
  expect(calls.some((call) => /cdp (Target.attachToTarget|Target.activateTarget|Target.closeTarget) old-alias$/.test(call))).toBe(false);
  for (const options of [{ extraBlank: true }, { transition: "chrome://newtab/" }, { transition: "https://example.com/redirect" }]) {
    const failed = androidStart(options);
    await expect(failed.target.start()).rejects.toThrow("left the fixture origin");
    expect(failed.calls).not.toContain("spawn screenrecord");
    await failed.target.cleanup();
  }
});

test("physical guards latch off-origin and visibility events even when polling sees a recovered fixture", async () => {
  for (const event of ["eventOffOrigin", "eventNewOffOrigin", "eventHide"] as const) {
    const test = androidStart(); await test.target.start(); test[event]();
    await expect(test.target.monitor()).rejects.toThrow("recording discarded");
    await expect(test.target.stop()).rejects.toThrow("recording discarded");
    expect(test.calls.some((call) => call.includes("pull"))).toBe(false);
    await test.target.cleanup();
  }
});

test("Android start persists mappings and recorder intent before creation and removes the old pid file", async () => {
  const { target, calls } = androidStart();
  await target.start();
  const reverse = calls.indexOf("-s device-test reverse --no-rebind tcp:3199 tcp:3199");
  const forward = calls.indexOf("-s device-test forward --no-rebind tcp:9222 localabstract:chrome_devtools_remote");
  const recorder = calls.indexOf("spawn screenrecord");
  expect(calls[reverse - 1]).toBe("persist true false false");
  expect(calls[forward - 1]).toBe("persist true true false");
  expect(calls[recorder - 2]).toBe("-s device-test shell rm -f /data/local/tmp/home-clip-resource-test.pid /sdcard/home-clip-resource-test.mp4");
  expect(calls[recorder - 1]).toBe("persist true true true");
});

test("the live Android stop path also refuses to signal a reused pid", async () => {
  const { target, calls, reusePid } = androidStart();
  await target.start(); reusePid(); await expect(target.stop()).rejects.toThrow("screenrecord ended early");
  expect(calls.some((call) => call.includes("kill -INT"))).toBe(false);
});

test("Android detects early screenrecord death while the session is idle", async () => {
  const { target, recorder } = androidStart();
  await target.start(); recorder.exitCode = 1;
  await expect(target.monitor()).rejects.toThrow("screenrecord ended early");
});

test("Android rejects indirect off-origin navigation during recording and before stop", async () => {
  const { target, offOrigin, calls } = androidStart();
  await target.start(); offOrigin();
  await expect(target.monitor()).rejects.toThrow("left the fixture origin");
  await expect(target.stop()).rejects.toThrow("left the fixture origin");
  expect(calls.some((call) => call.includes("pull"))).toBe(false);
});

test("physical Android never inspects or activates grandfathered tabs and closes only its own tab", async () => {
  const { target, state, calls } = androidStart();
  await target.start(); await target.monitor(); await target.cleanup();
  expect(state.preexistingTargets).toEqual(["old"]); expect(state.ownTarget).toBe("fixture");
  expect(calls.some((call) => /cdp (Target.attachToTarget|Target.activateTarget|Target.closeTarget) old$/.test(call))).toBe(false);
  expect(calls.filter((call) => call.startsWith("cdp Target.closeTarget"))).toEqual(["cdp Target.closeTarget fixture"]);
});
test("physical Android discards capture when its fixture loses foreground or a new off-origin target appears", async () => {
  const hidden = androidStart(); await hidden.target.start(); hidden.hide();
  await expect(hidden.target.monitor()).rejects.toThrow("no longer foreground");
  const popup = androidStart(); await popup.target.start(); popup.newOffOrigin();
  await expect(popup.target.monitor()).rejects.toThrow("left the fixture origin");
});

test("Android recovery closes only its persisted owned tab before removing CDP forwarding", async () => {
  const state = { ...stateFor(), serial: "device-test", ownTarget: "owned", preexistingTargets: ["old"], cdpPort: 9222, browserAttached: true };
  const calls: string[] = [];
  await localTarget(state, "/private-state", true, {
    readFile: (async () => "") as typeof import("node:fs/promises").readFile,
    acquireDeviceLock: async () => async () => { calls.push("release"); },
    connectCdp: async () => ({ command: async (method: string, params: { targetId?: string } = {}) => { calls.push(`${method} ${params.targetId ?? ""}`.trim()); return method === "Target.getTargets" ? { targetInfos: [{ targetId: "owned" }, { targetId: "old" }] } : {}; }, close() {} }) as never,
    browser: async () => { calls.push("disconnect"); return ""; },
    run: async () => { calls.push("device files"); return ""; },
  }).cleanup();
  expect(calls).toEqual(["Target.getTargets", "Target.closeTarget owned", "disconnect", "device files", "release"]);
});

test("remote recovery cleans the remote recorder, then output, then its tunnel", async () => {
  const state = { ...stateFor(), remote: true, remoteStarted: true, remoteOutput: "/tmp/clip output.mp4", remoteDir: "~/runner", remoteHost: "runner-test", socket: "/private-state/s" };
  const calls: string[] = [];
  await remoteTarget(state, "/private-state", {
    save: async () => { calls.push("persist stopped"); },
    run: async (_file, args) => { calls.push(args.at(-1)!); return ""; },
  }).cleanup();
  expect(calls).toEqual([remoteCommand(state, ["cleanup", "--session", "resource-test"]), "persist stopped", "rm -f '/tmp/clip output.mp4'", "runner-test"]);
});

test("remote recovery still stops the tunnel when remote cleanup is unreachable", async () => {
  const state = { ...stateFor(), remoteStarted: true, remoteDir: "~/runner", remoteHost: "runner-test", socket: "/private-state/s" };
  const calls: string[] = [];
  await expect(remoteTarget(state, "/private-state", {
    run: async (_file, args) => { calls.push(args.at(-1)!); if (args.includes("exit")) return ""; throw new CommandError("ssh failed", 255); },
  }).cleanup()).rejects.toThrow("Remote is unreachable");
  expect(calls.at(-1)).toBe("runner-test");
});

test("remote deterministic timeout text is not misclassified as unreachable", async () => {
  const state = { ...stateFor(), remoteStarted: true, remoteDir: "~/runner", remoteHost: "runner-test", socket: "/private-state/s" };
  await expect(remoteTarget(state, "/private-state", { run: async (_file, args) => { if (args.includes("exit")) return ""; throw new CommandError("Clip operation timed out", 1); } }).cleanup()).rejects.toThrow("remote recorder: Error: Clip operation timed out");
});

test("remote startup propagates emulator state and watches tunnel exit after readiness", async () => {
  const oldHost = process.env.HOME_CLIP_REMOTE, oldDir = process.env.HOME_CLIP_REMOTE_DIR;
  process.env.HOME_CLIP_REMOTE = "runner-test"; process.env.HOME_CLIP_REMOTE_DIR = "~/runner";
  try {
    const state = stateFor(); const tunnel = child(); const budgets: number[] = []; const cleanup: string[] = [];
    let masterReady = false;
    const target = remoteTarget(state, "/private-state", {
      now: () => 2000, until: immediate, save: async () => {},
      spawn: ((_file: string, args: string[]) => { expect(args).toContain("ControlPersist=no"); return tunnel; }) as typeof import("node:child_process").spawn,
      stopChild: async () => { cleanup.push("tunnel child"); },
      run: async (_file, args, options) => {
        const command = args.at(-1)!;
        if (args.includes("check")) masterReady = true;
        else if (!args.includes("exit")) { expect(masterReady).toBe(true); expect(args).toContain(state.socket!); }
        if (command.includes("bun -e")) return "0.38.1";
        if (command.includes("'start'")) budgets.push(options?.timeout ?? 0);
        if (command.includes("'__status'")) return JSON.stringify({ emulator: true, css: { width: 412, height: 811 } });
        if (command.includes("'cleanup'")) cleanup.push("remote cleanup");
        if (command.startsWith("rm -f")) cleanup.push("remote output");
        if (args.includes("exit")) cleanup.push("control exit");
        return "";
      },
    });
    await target.start();
    expect(state.emulator).toBe(true); expect(budgets).toEqual([180000]);
    tunnel.exitCode = 255;
    await expect(target.monitor()).rejects.toThrow("SSH tunnel dropped");
    await expect(target.stop("/tmp/out.mp4")).rejects.toThrow("SSH tunnel dropped");
    await target.cleanup();
    expect(cleanup).toEqual(["remote cleanup", "remote output", "tunnel child", "control exit"]);
  } finally {
    if (oldHost === undefined) delete process.env.HOME_CLIP_REMOTE; else process.env.HOME_CLIP_REMOTE = oldHost;
    if (oldDir === undefined) delete process.env.HOME_CLIP_REMOTE_DIR; else process.env.HOME_CLIP_REMOTE_DIR = oldDir;
  }
});

test("remote shell quoting preserves metacharacters in checkout paths and browser arguments", async () => {
  const home = await mkdtemp(join(tmpdir(), "clip-quote-"));
  try {
    const name = "runner ' ; $(false)"; const directory = join(home, name); await mkdir(directory);
    await writeFile(join(directory, "package.json"), JSON.stringify({ scripts: { clip: "bun echo.ts" } }));
    await writeFile(join(directory, "echo.ts"), "console.log(JSON.stringify(process.argv.slice(2)))");
    const args = ["ab", "--", "open", "http://127.0.0.1:3199/?q=';$(false)&x=`false`", "a\"b $HOME ; \\ end"];
    for (const remoteDir of [directory, `~/${name}`]) {
      const result = spawnSync("/bin/sh", ["-c", remoteCommand({ ...stateFor(), remoteDir }, args)], { env: { ...process.env, HOME: home }, encoding: "utf8" });
      expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual(args);
    }
    expect(sshArgs({ ...stateFor(), socket: "/tmp/path ' ;$x", remoteHost: "runner-test" }, "echo '$x' ; false")).toEqual(["-o", "BatchMode=yes", "-o", "ControlMaster=no", "-o", "ConnectTimeout=30", "-S", "/tmp/path ' ;$x", "runner-test", "echo '$x' ; false"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("session reads reject unsafe directories and cleanup removes an empty owned directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "clip-state-"));
  try {
    const directory = join(root, "session"); await privateDirectory(directory);
    await save(join(directory, "state.json"), { value: true });
    await chmod(directory, 0o755); await expect(load(join(directory, "state.json"))).rejects.toThrow("Unsafe clip state directory");
    await chmod(directory, 0o700); expect(await load(join(directory, "state.json"))).toEqual({ value: true });
    await rm(join(directory, "state.json")); await removeSession(directory);
    expect(await Bun.file(join(directory, "state.json")).exists()).toBe(false);
    expect(sessionDirectory("abc").split("/").at(-1)).toMatch(new RegExp(`^hc-${process.getuid!()}-[a-f0-9]{16}$`));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("worker identity rejects a matching pid with the wrong nonce or start time", async () => {
  const identity = await workerIdentity(process.pid, "not-in-command-line");
  expect(await workerAlive(identity)).toBe(false);
  expect(await workerAlive({ ...identity, started: "different start" })).toBe(false);
});
