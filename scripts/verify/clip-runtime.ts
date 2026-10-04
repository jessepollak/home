import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

export const repository = resolve(import.meta.dir, "../..");
export type ClipState = {
  session: string; target: "chromium" | "ios" | "android"; remote?: boolean;
  url?: string; device?: string; serial?: string; viewport: { width: number; height: number };
  raw: string; recorderPid?: number; deviceRecorderPid?: number; cdpPort?: number;
  css?: { width: number; height: number; outerWidth: number; dpr: number };
  model?: string; chromeVersion?: string; emulator?: boolean; startedAt?: number; recordingAt?: number;
  createdAt: number; maxAge: number; workerNonce: string; browserAttached?: boolean; recordingIntent?: boolean;
  remoteHost?: string; remoteDir?: string; socket?: string; tunnelPid?: number;
  ownerPid?: number; adbPath?: string; reversePort?: number; forwardCreated?: boolean;
  previousDnd?: string; chromeConfigured?: boolean; previousChromeCommand?: string | null; previousDebugApp?: string | null;
  remoteStarted?: boolean; remoteOutput?: string;
  preexistingTargets?: string[]; ownTarget?: string;
};
export const sessionDirectory = (name: string) => join(tmpdir(), `hc-${process.getuid!()}-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`);
export const exists = async (path: string) => Bun.file(path).exists();
export async function save(path: string, data: unknown) {
  await verifyDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.writing`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, path);
}
export async function verifyDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o700) throw new Error("Unsafe clip state directory: expected owned directory with mode 0700");
}
export async function load<T>(path: string): Promise<T> {
  await verifyDirectory(dirname(path));
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o600) throw new Error("Unsafe clip state file: expected owned file with mode 0600");
  return JSON.parse(await readFile(path, "utf8"));
}
export async function privateDirectory(path: string) { await mkdir(path, { mode: 0o700 }); await verifyDirectory(path); }

export function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
export type WorkerIdentity = { pid: number; nonce: string; started: string };
export async function workerIdentity(pid: number, nonce: string, inspect = run): Promise<WorkerIdentity> {
  const started = await inspect("ps", ["-p", String(pid), "-o", "lstart="]);
  return { pid, nonce, started };
}
export async function workerAlive(worker?: WorkerIdentity, inspect = run, isAlive = alive) {
  if (!worker || !isAlive(worker.pid) || !worker.started || !worker.nonce) return false;
  const started = await inspect("ps", ["-p", String(worker.pid), "-o", "lstart="]).catch(() => "");
  const command = await inspect("ps", ["-p", String(worker.pid), "-o", "command="]).catch(() => "");
  return started === worker.started && command.includes(worker.nonce) && command.includes("clip.ts");
}
export async function until(check: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Clip operation timed out after ${timeout / 1000}s`);
    await wait(100);
  }
}
export async function waitForResult(directory: string, session: string, dependencies: Partial<{ exists: typeof exists; load: typeof load; workerAlive: typeof workerAlive; until: typeof until }> = {}) {
  const deps = { exists, load, workerAlive, until, ...dependencies };
  const result = join(directory, "result.json");
  await deps.until(async () => {
    if (await deps.exists(result)) return true;
    const worker = await deps.load<WorkerIdentity>(join(directory, "worker.json")).catch(() => undefined);
    if (!await deps.workerAlive(worker)) {
      if (await deps.exists(result)) return true;
      throw new Error(`Clip worker is no longer running. Run: bun run clip cleanup --session ${session}`);
    }
    return false;
  }, 600000);
}
export const commandTerminationGrace = 5000;
export class CommandError extends Error {
  constructor(message: string, public exitCode: number | null) { super(message); }
}
export async function run(file: string, args: string[], options: { timeout?: number; signal?: AbortSignal; inherit?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const child = spawn(file, args, { cwd: repository, stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"], env: options.env ?? process.env });
  let stdout = "", stderr = "";
  child.stdout?.on("data", (data) => { stdout += data; });
  child.stderr?.on("data", (data) => { stderr += data; });
  let timedOut = false;
  const terminate = () => { child.kill("SIGTERM"); };
  options.signal?.addEventListener("abort", terminate, { once: true });
  if (options.signal?.aborted) terminate();
  const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeout ?? 60000);
  const force = setTimeout(() => { child.kill("SIGKILL"); }, (options.timeout ?? 60000) + commandTerminationGrace);
  try {
    const code = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("close", done); });
    if (options.signal?.aborted) throw new Error("Clip interrupted");
    if (timedOut) throw new Error(`${file} timed out`);
    if (code !== 0) throw new CommandError(`${file} ${args[0] ?? ""} failed (${code}): ${stderr.trim().slice(-1200)}`, code);
    return stdout.trim();
  } finally { clearTimeout(timer); clearTimeout(force); options.signal?.removeEventListener("abort", terminate); }
}
export async function stopChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const force = setTimeout(() => { child.kill("SIGKILL"); }, 5000);
  try { await new Promise<void>((done) => child.once("close", () => done())); }
  finally { clearTimeout(force); }
}
export async function removeSession(directory: string) {
  await verifyDirectory(directory).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await rm(directory, { recursive: true, force: true });
}
export const browserEnv = () => ({ ...process.env, AGENT_BROWSER_HEADED: "false" });
export const browser = (flags: string[], args: string[], options: { inherit?: boolean; signal?: AbortSignal } = {}) => run("bun", ["run", "--silent", "ab", "--", ...flags, ...args], { ...options, env: browserEnv() });
export async function probeVideo(path: string) {
  const output = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]);
  const frame = JSON.parse(output).streams?.[0];
  if (!frame?.width || !frame?.height) throw new Error("Recording contains no video frames");
  return frame as { width: number; height: number };
}
