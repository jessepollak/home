import { spawn } from "node:child_process";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { androidGeometry, assertFixtureNavigation, assertSessionAge, chromiumGeometry, webkitGeometry, measureCalibration, normalizationArgs, parseClipArgs, previewLabel, targetFlags } from "./clip-core.mjs";
import { localTarget } from "./clip-targets";
import { remoteCommand, remoteStartTimeout, remoteTarget, sshArgs } from "./clip-remote";
import { CommandError, browser, load, probeVideo, privateDirectory, removeSession, repository, run, save, sessionDirectory, until, verifyDirectory, waitForResult, workerAlive, workerIdentity, type ClipState, type WorkerIdentity } from "./clip-runtime";
import { validateWebkitCommand, webkitDevice } from "../../apps/web/scripts/clip-webkit";

type Request = { out?: string; cancel?: boolean };
type Result = { error?: string; cleanupError?: boolean; out?: string; width?: number; height?: number; label?: string };
type DriveRequest = { id: string; args: string[] };
type DriveResult = { id: string; value?: unknown; error?: string };

async function worker(directory: string) {
  const state = await load<ClipState>(join(directory, "state.json"));
  if (directory !== sessionDirectory(state.session) || process.argv[4] !== state.workerNonce) throw new Error("Invalid clip worker identity");
  await save(join(directory, "worker.json"), await workerIdentity(process.pid, state.workerNonce));
  const target = state.remote ? remoteTarget(state, directory) : localTarget(state, directory);
  const result: Result = {};
  let interrupted = false;
  const cancel = () => { interrupted = true; };
  let driving: Promise<void> | undefined;
  let driveError: unknown;
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel); process.on("SIGHUP", cancel);
  try {
    assertSessionAge(state, Date.now());
    await target.start();
    assertSessionAge(state, Date.now());
    if (interrupted) throw new Error("Clip interrupted");
    state.startedAt = Date.now();
    await save(join(directory, "state.json"), state);
    await save(join(directory, "ready.json"), true);
    let request: Request | undefined;
    await until(async () => {
      if (interrupted) throw new Error("Clip interrupted");
      assertSessionAge(state, Date.now());
      await target.monitor();
      if (driveError) throw driveError;
      if (state.target === "webkit" && !driving) {
        const drive = await load<DriveRequest>(join(directory, "drive.json")).catch(() => undefined);
        if (drive) {
          await rm(join(directory, "drive.json"), { force: true });
          driving = (async () => {
            const response: DriveResult = { id: drive.id };
            try { response.value = await target.command!(drive.args); } catch (error) { response.error = String(error); }
            await save(join(directory, "drive-result.json"), response);
          })().catch((error) => { driveError = error; }).finally(() => { driving = undefined; });
        }
      }
      request = await load<Request>(join(directory, "request.json")).catch(() => undefined);
      return Boolean(request);
    }, Infinity);
    assertSessionAge(state, Date.now());
    await target.monitor();
    if (request!.cancel) throw new Error("Clip cancelled");
    const out = request!.out!;
    await mkdir(dirname(out), { recursive: true });
    if (state.remote) Object.assign(result, await (target as ReturnType<typeof remoteTarget>).stop(out));
    else {
      await (target as ReturnType<typeof localTarget>).stop();
      const raw = await probeVideo(state.raw);
      let filter = null, trim = 0;
      if (state.target === "chromium") {
        const sample = join(directory, "calibration.rgb");
        await run("ffmpeg", ["-y", "-i", state.raw, "-t", "5", "-vf", "fps=30,crop=iw:16:0:0", "-f", "rawvideo", "-pix_fmt", "rgb24", sample]);
        const calibration = measureCalibration(new Uint8Array(await Bun.file(sample).arrayBuffer()), raw.width);
        await rm(sample, { force: true });
        filter = chromiumGeometry(raw, state.css!, calibration.markerWidth).filter;
        trim = calibration.trim;
      }
      if (state.target === "webkit") filter = webkitGeometry(raw, state.viewport).filter;
      if (state.target === "android" && !state.keepStatusBar) filter = androidGeometry(raw, state.androidScreen, state.statusBarHeight).filter;
      const temporary = join(directory, "normalized.mp4");
      await run("ffmpeg", normalizationArgs(state.raw, temporary, filter, trim), { timeout: 180000 });
      await Bun.write(out, Bun.file(temporary));
      Object.assign(result, await probeVideo(out), { label: previewLabel(state) });
    }
    result.out = out;
  } catch (error) { result.error = String(error); }
  finally {
    try { await target.cleanup(); } catch (error) { result.cleanupError = true; result.error = [result.error, String(error)].filter(Boolean).join("\n"); }
    await driving?.catch((error) => { result.error = [result.error, String(error)].filter(Boolean).join("\n"); });
    process.off("SIGINT", cancel); process.off("SIGTERM", cancel); process.off("SIGHUP", cancel);
    await rm(state.raw, { force: true });
    await rm(join(directory, "normalized.mp4"), { force: true });
    await save(join(directory, "result.json"), result);
  }
}

async function main() {
  const args = parseClipArgs(process.argv.slice(2));
  const directory = sessionDirectory(args.session);
  const controller = new AbortController();
  let owned = false, operation = false;
  const interrupted = () => { controller.abort(); };
  process.on("SIGINT", interrupted); process.on("SIGTERM", interrupted); process.on("SIGHUP", interrupted);
  async function finish(request: Request) {
    await save(join(directory, "request.json"), request);
    await waitForResult(directory, args.session);
    const result = await load<Result>(join(directory, "result.json"));
    if (result.cleanupError) { owned = false; throw new Error(`${result.error}\nCleanup remains pending. Run: bun run clip cleanup --session ${args.session}`); }
    await removeSession(directory);
    owned = false;
    if (result.error && !(request.cancel && result.error === "Error: Clip cancelled")) throw new Error(result.error);
    return result;
  }
  try {
    if (args.command === "start") {
      if (args.target === "webkit") webkitDevice(args.device);
      await privateDirectory(directory).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Clip session ${args.session} already exists; stop it first`);
        throw error;
      });
      owned = true;
      const state: ClipState = { session: args.session, target: args.target, viewport: args.viewport, url: args.url, device: args.device, fixture: args.fixture, serial: args.serial, remote: args.remote, keepStatusBar: args.keepStatusBar, raw: join(directory, ["chromium", "webkit"].includes(args.target) ? "raw.webm" : "raw.mp4"), maxAge: args.maxAge, createdAt: Date.now(), workerNonce: crypto.randomUUID() };
      await save(join(directory, "state.json"), state);
      const log = await open(join(directory, "worker.log"), "a", 0o600);
      const child = spawn(process.execPath, [join(repository, "scripts/verify/clip.ts"), "__worker", directory, state.workerNonce], { cwd: repository, detached: true, stdio: ["ignore", log.fd, log.fd] });
      child.on("error", (error) => { console.error(error); });
      child.unref(); await log.close();
      await until(async () => {
        if (controller.signal.aborted) throw new Error("Clip interrupted");
        if (await Bun.file(join(directory, "result.json")).exists()) {
          const result = await load<Result>(join(directory, "result.json"));
          throw new Error(result.error ?? "Clip could not start");
        }
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("Clip worker exited before recording; inspect its private worker.log");
        return Bun.file(join(directory, "ready.json")).exists();
      }, args.remote ? remoteStartTimeout : 120000);
      const ready = await load<ClipState>(join(directory, "state.json"));
      console.log(`Started ${args.session}${ready.remote ? " (remote)" : ""}`);
      if (!ready.remote) console.log(`Preview: ${previewLabel(ready)}`);
      owned = false;
    } else {
      try { await verifyDirectory(directory); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (args.command === "cleanup") { console.log(`Cleaned up ${args.session}`); return; }
        throw new Error(`No active clip session ${args.session}`);
      }
      const state = await load<ClipState>(join(directory, "state.json")).catch(async (error) => {
        if (error.code !== "ENOENT") throw error;
        if (args.command === "cleanup") { await removeSession(directory); return undefined; }
        throw new Error(`No active clip session ${args.session}`);
      });
      if (!state) { console.log(`Cleaned up ${args.session}`); return; }
      const worker = await load<WorkerIdentity>(join(directory, "worker.json")).catch(() => undefined);
      const failure = await load<Result>(join(directory, "result.json")).catch(() => undefined);
      if (args.command === "cleanup") {
        owned = false;
        if (failure && !failure.cleanupError) await removeSession(directory);
        else if (await workerAlive(worker)) await finish({ cancel: true });
        else {
          const target = state.remote ? remoteTarget(state, directory) : localTarget(state, directory, true);
          await target.cleanup(); await removeSession(directory);
        }
        console.log(`Cleaned up ${args.session}`); return;
      }
      if (failure) {
        if (!failure.cleanupError) await removeSession(directory);
        throw new Error(failure.error ?? "Clip session has ended");
      }
      if (!await workerAlive(worker)) throw new Error(`Clip worker is no longer running. Run: bun run clip cleanup --session ${args.session}`);
      await mkdir(join(directory, "operation"), { mode: 0o700 }).catch(() => { throw new Error("Another command is using this clip session"); });
      operation = true; owned = true;
      if (args.command === "ab") {
        assertFixtureNavigation(state, args.browserArgs);
        if (state.target === "webkit") {
          validateWebkitCommand(args.browserArgs);
          const id = crypto.randomUUID();
          await save(join(directory, "drive.json"), { id, args: args.browserArgs });
          let response: DriveResult | undefined;
          await until(async () => {
            if (controller.signal.aborted) throw new Error("Clip interrupted");
            const failure = await load<Result>(join(directory, "result.json")).catch(() => undefined);
            if (failure) throw new Error(failure.error ?? "Clip session has ended");
            if (!await workerAlive(worker)) {
              const ended = await load<Result>(join(directory, "result.json")).catch(() => undefined);
              throw new Error(ended?.error ?? `Clip worker is no longer running. Run: bun run clip cleanup --session ${args.session}`);
            }
            response = await load<DriveResult>(join(directory, "drive-result.json")).catch(() => undefined);
            return response?.id === id;
          }, Math.max(60000, state.maxAge * 1000));
          await rm(join(directory, "drive-result.json"), { force: true });
          if (response!.error) throw new Error(response!.error);
          const value = response!.value;
          console.log(typeof value === "string" ? value : JSON.stringify(value) ?? "OK");
        } else if (state.remote) {
          try { await run("ssh", sshArgs(state, remoteCommand(state, ["ab", "--session", args.session, "--", ...args.browserArgs])), { inherit: true, signal: controller.signal, timeout: 90000 }); }
          catch (error) {
            if (error instanceof CommandError && error.exitCode === 255) throw new Error(`Remote is unreachable: ${String(error)}. If cleanup cannot connect, retry: bun run clip cleanup --session ${args.session}`);
            throw error;
          }
        }
        else await browser(targetFlags(state), args.browserArgs, { inherit: true, signal: controller.signal });
        const failure = await load<Result>(join(directory, "result.json")).catch(() => undefined);
        if (failure?.error) throw new Error(failure.error);
        if (controller.signal.aborted) throw new Error("Clip interrupted");
        owned = false;
      } else {
        const out = resolve(args.out);
        const result = await finish({ out });
        if (controller.signal.aborted) throw new Error("Clip interrupted");
        console.log(`Output: ${result.out}\nPixels: ${result.width}×${result.height}\nPreview: ${result.label}`);
      }
    }
  } catch (error) {
    if (owned) {
      const worker = await load<WorkerIdentity>(join(directory, "worker.json")).catch(() => undefined);
      if (await workerAlive(worker)) await finish({ cancel: true }).catch((cleanupError) => { if (!String(cleanupError).includes("Clip cancelled")) console.error(cleanupError); });
      else {
        const result = await load<Result>(join(directory, "result.json")).catch(() => undefined);
        if (result?.cleanupError) console.error(`Cleanup remains pending. Run: bun run clip cleanup --session ${args.session}`);
        if (!result?.cleanupError) {
          const state = await load<ClipState>(join(directory, "state.json")).catch(() => undefined);
          if (state && !result) await (state.remote ? remoteTarget(state, directory) : localTarget(state, directory, true)).cleanup();
          await removeSession(directory);
        }
      }
    }
    throw error;
  } finally {
    if (operation) await rm(join(directory, "operation"), { recursive: true, force: true });
    process.off("SIGINT", interrupted); process.off("SIGTERM", interrupted); process.off("SIGHUP", interrupted);
  }
}
try {
  if (process.argv[2] === "__worker") await worker(process.argv[3]);
  else if (process.argv[2] === "__status") {
    const session = process.argv[3];
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(session ?? "")) throw new Error("Invalid clip session");
    const directory = sessionDirectory(session);
    const state = await load<ClipState>(join(directory, "state.json"));
    const result = await load<Result>(join(directory, "result.json")).catch(() => undefined);
    const identity = await load<WorkerIdentity>(join(directory, "worker.json")).catch(() => undefined);
    console.log(JSON.stringify({ css: state.css, emulator: state.emulator, model: state.model, chromeVersion: state.chromeVersion, statusBarHeight: state.statusBarHeight, androidScreen: state.androidScreen, error: result?.error ?? (!await workerAlive(identity) ? "Remote clip worker is no longer running" : undefined) }));
  } else await main();
} catch (error) { console.error(String(error)); process.exitCode = 1; }
