import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

export type SaveQaServer = {
  origin: string;
  stop: () => Promise<void>;
};

type ReadinessResponse = { status: number };
type SaveQaServerRuntime = {
  startupTimeoutMs?: number;
  stopGraceMs?: number;
  reservePort?: () => Promise<number>;
  launch?: (
    command: "dev" | "start",
    port: number,
    env: NodeJS.ProcessEnv,
  ) => ChildProcess;
  fetchReady?: (
    origin: string,
    init: { redirect: "manual"; signal: AbortSignal },
  ) => Promise<ReadinessResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

const webRoot = resolve(__dirname, "../../..");
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_STOP_GRACE_MS = 5_000;
const teardownTasks = new WeakMap<ChildProcess, Promise<void>>();

function controlledEnvironment(nodeEnv: "development" | "production", enabled: boolean): NodeJS.ProcessEnv {
  const copied = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SHELL", "TERM", "CI"];
  const env = {} as NodeJS.ProcessEnv;
  for (const key of copied) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    NODE_ENV: nodeEnv,
    HOME_ENABLE_SAVE_QA: enabled ? "1" : "0",
    NEXT_PUBLIC_CDP_PROJECT_ID: "",
    NEXT_PUBLIC_ENABLE_BASE_ACCOUNT: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function unusedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local Save QA port."));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function saveQaProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupGone(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (saveQaProcessGroupAlive(processGroupId)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(10, remainingMs)));
  }
  return true;
}

export function teardownSaveQaProcessGroup(
  child: ChildProcess,
  graceMs = DEFAULT_STOP_GRACE_MS,
): Promise<void> {
  const existing = teardownTasks.get(child);
  if (existing) return existing;

  const processGroupId = child.pid;
  const task = (async () => {
    if (!processGroupId) {
      if (childExited(child)) return;
      throw new Error("Save QA process group leader has no process id.");
    }
    if (!saveQaProcessGroupAlive(processGroupId)) return;
    signalProcessGroup(processGroupId, "SIGTERM");
    if (await waitForProcessGroupGone(processGroupId, graceMs)) return;
    signalProcessGroup(processGroupId, "SIGKILL");
    if (!(await waitForProcessGroupGone(processGroupId, graceMs))) {
      throw new Error(`Save QA process group ${processGroupId} survived SIGKILL.`);
    }
  })();
  teardownTasks.set(child, task);
  return task;
}

async function waitForServer(
  origin: string,
  child: ChildProcess,
  runtime: SaveQaServerRuntime,
): Promise<void> {
  const now = runtime.now ?? Date.now;
  const sleep = runtime.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)));
  const fetchReady = runtime.fetchReady ?? ((input, init) => fetch(input, init));
  const deadline = now() + (runtime.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  let lastFailure: unknown = null;

  while (now() < deadline) {
    if (childExited(child)) throw new Error(`Save QA server exited with ${child.exitCode}.`);
    const remainingMs = Math.max(1, deadline - now());
    try {
      const response = await fetchReady(origin, {
        redirect: "manual",
        signal: AbortSignal.timeout(remainingMs),
      });
      if (response.status < 500) return;
      lastFailure = new Error(`Save QA readiness returned ${response.status}.`);
    } catch (error) {
      lastFailure = error;
    }
    const afterFetchMs = deadline - now();
    if (afterFetchMs > 0) await sleep(Math.min(200, afterFetchMs));
  }
  throw new Error("Timed out waiting for the Save QA server.", { cause: lastFailure });
}

function defaultLaunch(
  command: "dev" | "start",
  port: number,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(
    "bun",
    ["x", "next", command, "--hostname", "localhost", "--port", String(port)],
    {
      cwd: webRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function start(
  command: "dev" | "start",
  env: NodeJS.ProcessEnv,
  runtime: SaveQaServerRuntime = {},
): Promise<SaveQaServer> {
  const port = await (runtime.reservePort ?? unusedPort)();
  const child = (runtime.launch ?? defaultLaunch)(command, port, env);
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  const origin = `http://localhost:${port}`;
  try {
    await waitForServer(origin, child, runtime);
  } catch (error) {
    await teardownSaveQaProcessGroup(child, runtime.stopGraceMs);
    throw new Error(`${String(error)}\n${output}`);
  }

  return {
    origin,
    stop: () => teardownSaveQaProcessGroup(child, runtime.stopGraceMs),
  };
}

export async function startSaveQaServerForTest(
  runtime: SaveQaServerRuntime,
): Promise<SaveQaServer> {
  return start("dev", controlledEnvironment("development", true), runtime);
}

export async function withSaveQaServer<T>(
  startServer: () => Promise<SaveQaServer>,
  runWithServer: (server: SaveQaServer) => Promise<T>,
): Promise<T> {
  const server = await startServer();
  try {
    return await runWithServer(server);
  } finally {
    await server.stop();
  }
}

export async function startSaveQaDevelopmentServer(enabled: boolean): Promise<SaveQaServer> {
  return start("dev", controlledEnvironment("development", enabled));
}

export function buildSaveQaProduction(): void {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: webRoot,
    env: controlledEnvironment("production", true),
    encoding: "utf8",
    timeout: 300_000,
  });
  if (result.status !== 0) {
    throw new Error(`Production build failed.\n${result.stdout}\n${result.stderr}`);
  }
}

export async function startSaveQaProductionServer(): Promise<SaveQaServer> {
  return start("start", controlledEnvironment("production", true));
}
