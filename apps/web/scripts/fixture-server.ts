import { execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { fixtureOperatorAddress, homeSessionSecret } from "../tests/browser/fixtures/session";
import { releaseFixturePort, reserveFixturePort } from "./fixture-port";

const LOCK_DIRECTORY = join(tmpdir(), "home-fixture-server");

interface FixtureState {
  version: 1;
  port: number;
  pid: number;
  command: string;
  logPath: string;
  startedAt: string;
  members?: string[];
}

interface StartOptions {
  port: number;
  statePath: string;
  logPath: string;
  command: { file: string; args: string[] };
  cwd: string;
  cards?: boolean;
  deadlineMs?: number;
}

export function parseFixturePort(explicit?: string, environment?: string): number {
  const requested = explicit ?? (environment === "" ? undefined : environment);
  const value = requested ?? "3199";
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error(`Invalid fixture port ${JSON.stringify(value)}; use a TCP port from 1 to 65535.`);
  }
  return Number(value);
}

export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolveProbe(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => error ? reject(error) : resolveProbe(true));
    });
  });
}

function removeFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readFixtureState(path: string, port: number): FixtureState | undefined {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const state = JSON.parse(content) as Partial<FixtureState> | null;
    if (!state || state.version !== 1 || state.port !== port || !Number.isInteger(state.port)
      || port < 1 || port > 65535 || typeof state.pid !== "number"
      || !Number.isInteger(state.pid) || state.pid <= 1 || state.pid > 2147483647
      || typeof state.command !== "string" || state.command.trim() === ""
      || typeof state.logPath !== "string" || state.logPath.trim() === ""
      || (state.members !== undefined && (!Array.isArray(state.members)
        || !state.members.every((member) => typeof member === "string")))
      || typeof state.startedAt !== "string" || !Number.isFinite(Date.parse(state.startedAt))) {
      throw new Error("invalid fields");
    }
    return state as FixtureState;
  } catch {
    throw new Error(`Malformed fixture server state at ${path}; inspect the record before retrying.`);
  }
}

function makeDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

async function withLifecycleLock<T>(port: number, operation: () => Promise<T>): Promise<T> {
  const claim = reserveFixturePort(port, LOCK_DIRECTORY);
  if (!claim) {
    throw new Error(`Another fixture-server operation is in progress on port ${port}; wait for it to finish and retry.`);
  }
  try {
    return await operation();
  } finally {
    releaseFixturePort(claim);
  }
}

export function writeFixtureState(path: string, state: FixtureState): void {
  makeDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function groupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function findLeaderCommand(pid: number): string | undefined {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-ww", "-p", String(pid)], { encoding: "utf8" }).trim();
    return command || undefined;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return undefined;
    throw new Error(`Cannot verify fixture process group ${pid}; its leader is no longer available.`);
  }
}

function leaderCommand(pid: number): string {
  const command = findLeaderCommand(pid);
  if (!command) throw new Error(`Cannot verify fixture process group ${pid}; its leader is no longer available.`);
  return command;
}

function groupMembers(pid: number): string[] {
  const processes = execFileSync("ps", ["-Ao", "pid=,pgid=,command=", "-ww"], { encoding: "utf8" });
  return processes.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match && Number(match[2]) === pid ? [`${match[1]} ${match[3].trim()}`] : [];
  });
}

async function poll(check: () => boolean | Promise<boolean>, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  do {
    if (await check()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await wait(Math.min(100, remaining));
  } while (true);
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function terminateGroup(pid: number): Promise<void> {
  signalGroup(pid, "SIGTERM");
  if (await poll(() => !groupIsAlive(pid), 10_000)) return;
  signalGroup(pid, "SIGKILL");
  if (!await poll(() => !groupIsAlive(pid), 5_000)) {
    throw new Error(`Fixture process group ${pid} is still alive after SIGKILL; inspect it before retrying.`);
  }
}

function occupiedMessage(port: number): string {
  return `Port ${port} is held by another process; wait for it to be free or choose another fixture port. No unrelated process was signaled.`;
}

async function confirmPortFree(port: number): Promise<void> {
  if (!await poll(() => portIsFree(port), 10_000)) throw new Error(occupiedMessage(port));
}

function logTail(path: string): string {
  try {
    const descriptor = openSync(path, "r");
    try {
      const file = readFileSync(descriptor, "utf8");
      return file.slice(-4096).trim().split("\n").slice(-12).join("\n");
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    return `Could not read server log: ${String(error)}`;
  }
}

export async function startFixtureServer(options: StartOptions): Promise<FixtureState> {
  return withLifecycleLock(options.port, () => startLockedFixtureServer(options));
}

async function startLockedFixtureServer(options: StartOptions): Promise<FixtureState> {
  const { port, statePath, logPath, command, cwd, cards = false, deadlineMs = 120_000 } = options;
  const previous = readFixtureState(statePath, port);
  if (previous && groupIsAlive(previous.pid)) {
    throw new Error(`fixture server already running on port ${port} (group ${previous.pid}); stop it first`);
  }
  if (!await portIsFree(port)) throw new Error(occupiedMessage(port));
  makeDirectory(dirname(logPath));
  const descriptor = openSync(logPath, "w", 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command.file, command.args, {
      cwd,
      detached: true,
      stdio: ["ignore", descriptor, descriptor],
      env: {
        ...(cards ? { BRIDGE_CARDS_ENABLED: "1" } : {}),
        DATABASE_URL: "",
        HOME: homedir(),
        PATH: process.env.PATH,
        NEXT_TELEMETRY_DISABLED: "1",
        HOME_PLAYWRIGHT_SMOKE: "1",
        HOME_FIXTURE_PORT: String(port),
        HOME_SESSION_SECRET: homeSessionSecret,
        HOME_OPERATOR_ADDRESSES: fixtureOperatorAddress,
      } as unknown as NodeJS.ProcessEnv,
    });
  } finally {
    closeSync(descriptor);
  }
  let failure: Error | undefined;
  let rejectFailure: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
  const fail = (error: Error) => {
    failure = error;
    rejectFailure(error);
  };
  child.once("error", fail);
  child.once("exit", (code, signal) => fail(new Error(`Fixture server leader exited (${signal ?? code}).`)));
  const interrupted = (signal: NodeJS.Signals) => fail(new Error(`Fixture server start interrupted by ${signal}.`));
  const interrupt = () => interrupted("SIGINT");
  const terminate = () => interrupted("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  const controller = new AbortController();
  try {
    await Promise.race([
      new Promise<void>((resolveSpawn, reject) => {
        child.once("spawn", resolveSpawn);
        child.once("error", reject);
      }),
      failed,
    ]);
    const deadline = Date.now() + deadlineMs;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try {
        const remaining = deadline - Date.now();
        const response = await Promise.race([
          fetch(`http://127.0.0.1:${port}/home`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(remaining, 2000)))]),
          }),
          failed,
        ]);
        await response.body?.cancel();
        if (response.status < 500) { ready = true; break; }
      } catch (error) {
        if (failure) throw failure;
        if (controller.signal.aborted) throw error;
      }
      await Promise.race([wait(Math.min(100, Math.max(0, deadline - Date.now()))), failed]);
    }
    if (!ready) throw new Error(`Fixture server did not become ready within ${deadlineMs}ms.`);
    if (failure) throw failure;
    const state: FixtureState = {
      version: 1,
      port,
      pid: child.pid!,
      command: leaderCommand(child.pid!),
      logPath,
      startedAt: new Date().toISOString(),
      members: groupMembers(child.pid!),
    };
    writeFixtureState(statePath, state);
    child.unref();
    return state;
  } catch (error) {
    controller.abort();
    let cleanup = "";
    try {
      if (child.pid) await terminateGroup(child.pid);
      await confirmPortFree(port);
    } catch (cleanupError) {
      cleanup = `\nCleanup failed: ${String(cleanupError)}`;
    }
    throw new Error(`${String(error)}${cleanup}\nFixture server log: ${logPath}\n${logTail(logPath)}`);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    void failed.catch(() => {});
  }
}

export async function stopFixtureServer(options: { port: number; statePath: string }): Promise<string> {
  return withLifecycleLock(options.port, () => stopLockedFixtureServer(options));
}

async function stopLockedFixtureServer(options: { port: number; statePath: string }): Promise<string> {
  const { port, statePath } = options;
  const state = readFixtureState(statePath, port);
  if (!state) throw new Error(`no fixture server recorded for port ${port} at ${statePath}`);
  if (!groupIsAlive(state.pid)) {
    if (!await portIsFree(port)) {
      removeFile(statePath);
      throw new Error(occupiedMessage(port));
    }
    removeFile(statePath);
    removeFile(state.logPath);
    return `fixture server already stopped; port ${port} free`;
  }
  const command = findLeaderCommand(state.pid);
  const authenticated = command === state.command
    || (command === undefined && groupMembers(state.pid).some((member) => state.members?.includes(member)));
  if (!authenticated) {
    throw new Error(`Fixture process group ${state.pid} command does not match its recorded leader; refusing to signal a possibly reused PID.`);
  }
  await terminateGroup(state.pid);
  await confirmPortFree(port);
  removeFile(statePath);
  removeFile(state.logPath);
  return `fixture server on port ${port} stopped; port free`;
}

export async function runFixtureServer(args: string[]): Promise<number> {
  try {
    const [action, ...flags] = args;
    if (action !== "start" && action !== "stop") {
      throw new Error("Usage: fixture-server start [--port <n>] [--state <path>] [--cards] | stop [--port <n>] [--state <path>]");
    }
    let explicitPort: string | undefined;
    let explicitState: string | undefined;
    let cards = false;
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index];
      if (flag === "--cards") {
        if (action !== "start") throw new Error("--cards is only valid with start.");
        cards = true;
        continue;
      }
      const value = flags[index + 1];
      if (!value || value.startsWith("--") || (flag !== "--port" && flag !== "--state")) {
        throw new Error(`Invalid fixture-server option ${flag}; use --port <n> or --state <path>.`);
      }
      if (flag === "--port") explicitPort = value;
      else explicitState = value;
      index += 1;
    }
    const port = parseFixturePort(explicitPort, process.env.HOME_FIXTURE_PORT);
    const directory = join(tmpdir(), "home-fixture-server");
    const statePath = explicitState ? resolve(explicitState) : join(directory, `${port}.json`);
    if (action === "stop") {
      process.stdout.write(`${await stopFixtureServer({ port, statePath })}\n`);
    } else {
      const state = await startFixtureServer({
        port,
        statePath,
        cards,
        logPath: join(directory, `${port}.log`),
        command: { file: "bun", args: ["run", "dev", "--", "--port", String(port)] },
        cwd: resolve(import.meta.dir, ".."),
      });
      process.stdout.write(`fixture server ready on http://127.0.0.1:${port} (process group ${state.pid}, log ${state.logPath})\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runFixtureServer(process.argv.slice(2));
