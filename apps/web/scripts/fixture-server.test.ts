import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
// oxlint-disable-next-line home/no-source-reads -- Tests read only their own system-temp state and log files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { probeFixturePort } from "./fixture-port";
import {
  parseFixturePort,
  portIsFree,
  readFixtureState,
  startFixtureServer,
  stopFixtureServer,
  writeFixtureState,
} from "./fixture-server";

const children: ChildProcess[] = [];
const groups: number[] = [];
const directories: string[] = [];
const locks: string[] = [];
const SERVER = 'require("node:http").createServer((_, res) => res.end("fixture")).listen(Number(process.env.HOME_FIXTURE_PORT), "127.0.0.1", () => console.log("listening"));';

// Each case spawns fixture-server processes and waits on their readiness, which a loaded
// shared runner can stretch past Bun's 5 s default; the file carries its own per-case budget
// so the file-order check does not kill a case that passes in isolation.
setDefaultTimeout(20_000);

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    child.once("exit", () => resolveExit());
    child.once("error", reject);
  });
}

function signal(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

afterEach(async () => {
  const signaled = new Set<number>();
  for (const pid of groups.splice(0)) {
    signaled.add(pid);
    signal(-pid);
  }
  for (const child of children.splice(0)) {
    const done = exited(child);
    if (child.pid && !signaled.has(child.pid)) signal(-child.pid);
    await done;
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const path of locks.splice(0)) rmSync(path, { force: true });
});

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "home-fixture-server-test-"));
  directories.push(directory);
  const port = probeFixturePort();
  if (port === null) throw new Error("Could not select a free test port");
  lifecycleClaim(port);
  return {
    port,
    statePath: join(directory, "state.json"),
    logPath: join(directory, "server.log"),
    cwd: directory,
  };
}

function lifecycleClaim(port: number, pid = process.pid): string {
  const directory = join(tmpdir(), "home-fixture-server");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${port}.${pid}.lock`);
  locks.push(path);
  return path;
}

function lifecycleClaims(port: number): string[] {
  return readdirSync(join(tmpdir(), "home-fixture-server")).filter((entry) => entry.startsWith(`${port}.`) && entry.endsWith(".lock"));
}

function stateRecord(port: number, logPath: string, pid = 2147483647) {
  return { version: 1 as const, port, pid, command: "fixture-test", logPath, startedAt: "2026-01-01T00:00:00.000Z" };
}

async function foreignServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", SERVER], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { HOME_FIXTURE_PORT: String(port) } as unknown as NodeJS.ProcessEnv,
  });
  children.push(child);
  await new Promise<void>((resolveReady, reject) => {
    child.stdout!.once("data", () => resolveReady());
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Foreign server exited: ${code}`)));
  });
  return child;
}

async function cli(...args: string[]) {
  const child = spawn(process.execPath, [resolve(import.meta.dir, "fixture-server.ts"), ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (data) => { stdout += String(data); });
  child.stderr!.on("data", (data) => { stderr += String(data); });
  await new Promise<void>((resolveClose, reject) => {
    child.once("close", () => resolveClose());
    child.once("error", reject);
  });
  return { code: child.exitCode, stdout, stderr };
}

function alive(child: ChildProcess): boolean {
  if (!child.pid) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("fixture port uses explicit value, then environment, then 3199", () => {
  expect(parseFixturePort("3219", "4000")).toBe(3219);
  expect(parseFixturePort(undefined, "4000")).toBe(4000);
  expect(parseFixturePort()).toBe(3199);
  expect(parseFixturePort("65535")).toBe(65535);
});

test("invalid explicit and environment ports are rejected", () => {
  for (const value of ["0", "-1", "01", "65536", "100000", "1.5", "abc", " 3199", "3199\n"]) {
    expect(() => parseFixturePort(value)).toThrow(/Invalid fixture port/);
    expect(() => parseFixturePort(undefined, value)).toThrow(/Invalid fixture port/);
  }
  expect(() => parseFixturePort("")).toThrow(/Invalid fixture port/);
});

test("an empty environment port falls back to the default", () => {
  expect(parseFixturePort(undefined, "")).toBe(3199);
});

test("port probe detects a real listening server and a free port", async () => {
  const { port } = scratch();
  expect(await portIsFree(port)).toBe(true);
  const child = await foreignServer(port);
  expect(await portIsFree(port)).toBe(false);
  const done = exited(child);
  signal(-child.pid!);
  await done;
  expect(await portIsFree(port)).toBe(true);
});

test("state round trip preserves the record and private file mode", () => {
  const { port, statePath, logPath } = scratch();
  const state = stateRecord(port, logPath);
  expect(readFixtureState(statePath, port)).toBeUndefined();
  writeFixtureState(statePath, state);
  expect(readFixtureState(statePath, port)).toEqual(state);
  expect(statSync(statePath).mode & 0o777).toBe(0o600);
});

test("malformed, unsafe, and wrong-port state records are rejected", () => {
  const { port, statePath, logPath } = scratch();
  const state = stateRecord(port, logPath);
  for (const invalid of ["{", "null", "[]", JSON.stringify({ ...state, version: 2 }),
    JSON.stringify({ ...state, pid: 0 }), JSON.stringify({ ...state, pid: -5 }),
    JSON.stringify({ ...state, pid: 4294967296 }),
    JSON.stringify({ ...state, command: "" }), JSON.stringify({ ...state, logPath: "" }),
    JSON.stringify({ ...state, members: "invalid" }), JSON.stringify({ ...state, members: [1] }),
    JSON.stringify({ ...state, startedAt: "invalid" }), JSON.stringify({ ...state, port: port + 1 })]) {
    writeFileSync(statePath, invalid);
    expect(() => readFixtureState(statePath, port)).toThrow(/Malformed fixture server state/);
  }
});

test("injected start records a live leader and stop removes the state and log", async () => {
  const options = scratch();
  const source = 'console.log(JSON.stringify(Object.keys(process.env).sort()));' + SERVER;
  const state = await startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", source] } });
  groups.push(state.pid);
  expect(state.port).toBe(options.port);
  expect(state.command).toContain(process.execPath);
  expect(state.members).toContain(`${state.pid} ${state.command}`);
  expect(readFixtureState(options.statePath, options.port)).toEqual(state);
  expect(existsSync(options.logPath)).toBe(true);
  expect(readFileSync(options.logPath, "utf8")).toContain("listening");
  expect(JSON.parse(readFileSync(options.logPath, "utf8").split("\n")[0])).toEqual([
    "DATABASE_URL", "HOME", "HOME_FIXTURE_PORT", "HOME_OPERATOR_ADDRESSES", "HOME_PLAYWRIGHT_SMOKE", "HOME_SESSION_SECRET", "NEXT_TELEMETRY_DISABLED", "PATH",
  ]);
  expect(await stopFixtureServer(options)).toBe(`fixture server on port ${options.port} stopped; port free`);
  expect(await portIsFree(options.port)).toBe(true);
  expect(existsSync(options.statePath)).toBe(false);
  expect(existsSync(options.logPath)).toBe(false);
});

test("a live sibling's empty claim blocks start and stop until its holder releases it", async () => {
  const options = scratch();
  const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  children.push(sibling);
  await new Promise<void>((resolveSpawn, reject) => {
    sibling.once("spawn", resolveSpawn);
    sibling.once("error", reject);
  });
  const path = lifecycleClaim(options.port, sibling.pid);
  writeFileSync(path, "", { mode: 0o600 });
  const message = `Another fixture-server operation is in progress on port ${options.port}; wait for it to finish and retry.`;
  await expect(startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", SERVER] } })).rejects.toThrow(message);
  await expect(stopFixtureServer(options)).rejects.toThrow(message);
  expect(readFileSync(path, "utf8")).toBe("");
  expect(lifecycleClaims(options.port)).toEqual([`${options.port}.${sibling.pid}.lock`]);
  const done = exited(sibling);
  signal(-sibling.pid!);
  await done;
  rmSync(path);
  const state = await startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", SERVER] } });
  groups.push(state.pid);
  expect(existsSync(path)).toBe(false);
  await stopFixtureServer(options);
  expect(await portIsFree(options.port)).toBe(true);
  expect(lifecycleClaims(options.port)).toEqual([]);
});

test("a dead owner's claim is reclaimed before start", async () => {
  const options = scratch();
  const dead = spawn(process.execPath, ["-e", "process.exit(0);"], { detached: true });
  children.push(dead);
  await exited(dead);
  expect(() => process.kill(dead.pid!, 0)).toThrow();
  const path = lifecycleClaim(options.port, dead.pid);
  writeFileSync(path, `${dead.pid}\n`, { mode: 0o600 });
  const state = await startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", SERVER] } });
  groups.push(state.pid);
  expect(existsSync(path)).toBe(false);
  await stopFixtureServer(options);
  expect(await portIsFree(options.port)).toBe(true);
  expect(lifecycleClaims(options.port)).toEqual([]);
});

test("concurrent starts allow exactly one server and stop leaves no surviving group", async () => {
  const options = { ...scratch(), command: { file: process.execPath, args: ["-e", SERVER] } };
  const results = await Promise.allSettled([startFixtureServer(options), startFixtureServer(options)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const started = results.find((result) => result.status === "fulfilled");
  if (!started || started.status !== "fulfilled") throw new Error("Neither fixture server started");
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected?.status === "rejected" && String(rejected.reason)).toContain(`Another fixture-server operation is in progress on port ${options.port}`);
  groups.push(started.value.pid);
  expect(readFixtureState(options.statePath, options.port)).toEqual(started.value);
  await stopFixtureServer(options);
  expect(await portIsFree(options.port)).toBe(true);
  expect(() => process.kill(-started.value.pid, 0)).toThrow();
});

test("cross-process starts never overlap or remove a live competitor's claim when reclaiming stale claims", async () => {
  const options = scratch();
  const dead = spawn(process.execPath, ["-e", "process.exit(0);"], { detached: true });
  children.push(dead);
  await exited(dead);
  expect(() => process.kill(dead.pid!, 0)).toThrow();
  const stale = lifecycleClaim(options.port, dead.pid);
  writeFileSync(stale, `${dead.pid}\n`, { mode: 0o600 });
  const script = join(options.cwd, "start.ts");
  writeFileSync(script, `
const { startFixtureServer } = await import(process.env.HELPER_URL);
try {
  const state = await startFixtureServer({
    port: Number(process.env.HOME_FIXTURE_PORT),
    statePath: process.env.STATE_PATH,
    logPath: process.env.LOG_PATH,
    cwd: process.cwd(),
    command: { file: process.execPath, args: ["-e", process.env.SERVER] },
  });
  console.log(JSON.stringify(state));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`);
  const starts = [0, 1].map(() => {
    const child = spawn(process.execPath, [script], {
      cwd: options.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HELPER_URL: pathToFileURL(resolve(import.meta.dir, "fixture-server.ts")).href,
        HOME_FIXTURE_PORT: String(options.port),
        STATE_PATH: options.statePath,
        LOG_PATH: options.logPath,
        SERVER,
      },
    });
    children.push(child);
    lifecycleClaim(options.port, child.pid);
    const output = { child, stdout: "", stderr: "" };
    child.stdout!.on("data", (data) => { output.stdout += String(data); });
    child.stderr!.on("data", (data) => { output.stderr += String(data); });
    return output;
  });
  await Promise.all(starts.map(({ child }) => exited(child)));
  const state = readFixtureState(options.statePath, options.port);
  if (state) groups.push(state.pid);
  const winners = starts.filter(({ child }) => child.exitCode === 0);
  expect(winners.length).toBeLessThanOrEqual(1);
  for (const loser of starts.filter(({ child }) => child.exitCode !== 0)) {
    expect(loser.child.exitCode).toBe(1);
    expect(loser.stderr).toContain(`Another fixture-server operation is in progress on port ${options.port}; wait for it to finish and retry.`);
  }
  if (winners.length === 1) {
    expect(state).toEqual(JSON.parse(winners[0].stdout));
    expect(await portIsFree(options.port)).toBe(false);
    await stopFixtureServer(options);
  } else {
    expect(state).toBeUndefined();
  }
  expect(existsSync(stale)).toBe(false);
  expect(await portIsFree(options.port)).toBe(true);
  expect(lifecycleClaims(options.port)).toEqual([]);
});

test("start fails loudly without killing a foreign port occupant", async () => {
  const { port, statePath } = scratch();
  const foreign = await foreignServer(port);
  const result = await cli("start", "--port", String(port), "--state", statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(`Port ${port} is held by another process`);
  expect(result.stdout).toBe("");
  expect(alive(foreign)).toBe(true);
  expect(await portIsFree(port)).toBe(false);
  expect(existsSync(statePath)).toBe(false);
});

test("stop without a state file fails without signaling", async () => {
  const { port, statePath } = scratch();
  const result = await cli("stop", "--port", String(port), "--state", statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(`no fixture server recorded for port ${port} at ${statePath}`);
});

test("stop removes stale state but never signals a foreign port occupant", async () => {
  const { port, statePath, logPath } = scratch();
  const foreign = await foreignServer(port);
  writeFixtureState(statePath, stateRecord(port, logPath));
  const result = await cli("stop", "--port", String(port), "--state", statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(`Port ${port} is held by another process`);
  expect(alive(foreign)).toBe(true);
  expect(await portIsFree(port)).toBe(false);
  expect(existsSync(statePath)).toBe(false);
});

test("stop kills the detached leader's listening grandchild, freeing its port", async () => {
  const options = scratch();
  const source = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { stdio: "inherit" });`;
  const state = await startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", source] } });
  groups.push(state.pid);
  expect(await portIsFree(options.port)).toBe(false);
  await stopFixtureServer(options);
  expect(await portIsFree(options.port)).toBe(true);
  expect(() => process.kill(-state.pid, 0)).toThrow();
  expect(existsSync(options.statePath)).toBe(false);
  expect(existsSync(options.logPath)).toBe(false);
});

test("stop authenticates a listening orphaned grandchild after only the leader is killed", async () => {
  const options = scratch();
  const source = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(SERVER)}], { stdio: "inherit" }).ref();`;
  const leader = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { HOME_FIXTURE_PORT: String(options.port) } as unknown as NodeJS.ProcessEnv,
  });
  children.push(leader);
  groups.push(leader.pid!);
  let stdout = "";
  await new Promise<void>((resolveReady, reject) => {
    leader.stdout!.on("data", (data) => {
      stdout += String(data);
      if (stdout.includes("listening\n")) resolveReady();
    });
    leader.once("error", reject);
    leader.once("exit", (code) => reject(new Error(`Fixture leader exited before readiness: ${code}`)));
  });
  const command = execFileSync("ps", ["-o", "command=", "-ww", "-p", String(leader.pid)], { encoding: "utf8" }).trim();
  const processes = execFileSync("ps", ["-Ao", "pid=,pgid=,command=", "-ww"], { encoding: "utf8" });
  const members = processes.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match && Number(match[2]) === leader.pid ? [`${match[1]} ${match[3].trim()}`] : [];
  });
  expect(members.length).toBeGreaterThan(1);
  writeFileSync(options.logPath, stdout, { mode: 0o600 });
  writeFixtureState(options.statePath, {
    ...stateRecord(options.port, options.logPath, leader.pid),
    command,
    members,
  });
  expect(existsSync(options.statePath)).toBe(true);
  expect(existsSync(options.logPath)).toBe(true);
  const done = exited(leader);
  signal(leader.pid!);
  await done;
  expect(() => process.kill(leader.pid!, 0)).toThrow();
  expect(await portIsFree(options.port)).toBe(false);
  expect(() => process.kill(-leader.pid!, 0)).not.toThrow();
  expect(await stopFixtureServer(options)).toBe(`fixture server on port ${options.port} stopped; port free`);
  expect(await portIsFree(options.port)).toBe(true);
  expect(() => process.kill(-leader.pid!, 0)).toThrow();
  expect(existsSync(options.statePath)).toBe(false);
  expect(existsSync(options.logPath)).toBe(false);
});

test("unmatched recorded members cannot authenticate a live foreign process group", async () => {
  const options = scratch();
  const foreign = await foreignServer(options.port);
  writeFixtureState(options.statePath, {
    ...stateRecord(options.port, options.logPath, foreign.pid),
    members: ["2147483647 not-a-fixture-process"],
  });
  await expect(stopFixtureServer(options)).rejects.toThrow("refusing to signal a possibly reused PID");
  expect(alive(foreign)).toBe(true);
  expect(await portIsFree(options.port)).toBe(false);
  expect(existsSync(options.statePath)).toBe(true);
});

test("an already-running group blocks a second start", async () => {
  const options = scratch();
  const state = await startFixtureServer({ ...options, command: { file: process.execPath, args: ["-e", SERVER] } });
  groups.push(state.pid);
  const result = await cli("start", "--port", String(options.port), "--state", options.statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(`fixture server already running on port ${options.port} (group ${state.pid}); stop it first`);
  await stopFixtureServer(options);
});

test("malformed state and a reused leader command prevent stop from signaling", async () => {
  const options = scratch();
  const foreign = await foreignServer(options.port);
  writeFileSync(options.statePath, "not json");
  let result = await cli("stop", "--port", String(options.port), "--state", options.statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Malformed fixture server state");
  writeFixtureState(options.statePath, stateRecord(options.port, options.logPath, foreign.pid));
  result = await cli("stop", "--port", String(options.port), "--state", options.statePath);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("refusing to signal a possibly reused PID");
  expect(alive(foreign)).toBe(true);
  expect(existsSync(options.statePath)).toBe(true);
});

test("a stale record with a free port is cleaned up successfully", async () => {
  const options = scratch();
  writeFixtureState(options.statePath, stateRecord(options.port, options.logPath));
  writeFileSync(options.logPath, "old log");
  expect(await stopFixtureServer(options)).toBe(`fixture server already stopped; port ${options.port} free`);
  expect(existsSync(options.statePath)).toBe(false);
  expect(existsSync(options.logPath)).toBe(false);
});

test("an exited leader fails start with its log and leaves the port free", async () => {
  const options = scratch();
  await expect(startFixtureServer({
    ...options,
    command: { file: process.execPath, args: ["-e", 'console.error("stub failed"); process.exit(2);'] },
  })).rejects.toThrow(/Fixture server leader exited.*\nFixture server log: .*\nstub failed/);
  expect(await portIsFree(options.port)).toBe(true);
  expect(existsSync(options.statePath)).toBe(false);
});

test("a readiness deadline failure kills the group and reports its log", async () => {
  const options = scratch();
  await expect(startFixtureServer({
    ...options,
    command: { file: process.execPath, args: ["-e", SERVER] },
    deadlineMs: 0,
  })).rejects.toThrow(/did not become ready within 0ms.*\nFixture server log:/);
  expect(await portIsFree(options.port)).toBe(true);
  expect(existsSync(options.statePath)).toBe(false);
});
