import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

export type SaveQaServer = {
  origin: string;
  stop: () => Promise<void>;
};

const webRoot = resolve(__dirname, "../../..");

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

async function waitForServer(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Save QA server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Timed out waiting for the Save QA server.");
}

async function start(command: "dev" | "start", env: NodeJS.ProcessEnv): Promise<SaveQaServer> {
  const port = await unusedPort();
  const child = spawn(
    "bun",
    ["x", "next", command, "--hostname", "localhost", "--port", String(port)],
    {
      cwd: webRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => { output += String(chunk); });
  child.stderr?.on("data", (chunk) => { output += String(chunk); });
  const origin = `http://localhost:${port}`;
  try {
    await waitForServer(origin, child);
  } catch (error) {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    throw new Error(`${String(error)}\n${output}`);
  }
  return {
    origin,
    stop: async () => {
      if (child.exitCode !== null) return;
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      await Promise.race([
        new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(() => {
          if (child.pid) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* already stopped */ }
          }
          resolveTimeout();
        }, 5_000)),
      ]);
    },
  };
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
