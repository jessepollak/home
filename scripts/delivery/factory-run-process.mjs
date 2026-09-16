import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GITHUB_CREDENTIAL_NAMES = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GIT_ASKPASS",
  "GIT_CONFIG_GLOBAL",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "SSH_ASKPASS",
  "SSH_AUTH_SOCK",
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;

function isGitHubCredentialName(name) {
  return GITHUB_CREDENTIAL_NAMES.has(name) ||
    (/^(?:GH|GITHUB)_/.test(name) && /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(name));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function prepareIsolatedModelHome(environment) {
  const isolatedHome = await mkdtemp(join(tmpdir(), "home-factory-child-"));
  try {
    const agentDirectory = join(isolatedHome, ".pi", "agent");
    await mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    await mkdir(join(isolatedHome, ".config", "gh"), { recursive: true, mode: 0o700 });

    const sourceHome = environment.HOME;
    if (!sourceHome) return isolatedHome;

    const sourceAgentDirectory = join(sourceHome, ".pi", "agent");
    try {
      const gatewayToken = await readFile(join(sourceAgentDirectory, "llm-gateway-token"));
      await writeFile(join(agentDirectory, "llm-gateway-token"), gatewayToken, { mode: 0o600 });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const sourceSettings = await readJson(join(sourceAgentDirectory, "settings.json"));
    const provider = environment.PI_PROVIDER || sourceSettings?.defaultProvider;
    const model = environment.PI_MODEL || sourceSettings?.defaultModel;
    if (provider || model) {
      await writeJson(join(agentDirectory, "settings.json"), {
        ...(provider ? { defaultProvider: provider } : {}),
        ...(model ? { defaultModel: model } : {}),
        quietStartup: true,
      });
    }

    if (!provider) return isolatedHome;
    const sourceModels = await readJson(join(sourceAgentDirectory, "models.json"));
    const providerModel = sourceModels?.providers?.[provider];
    if (providerModel) {
      await writeJson(join(agentDirectory, "models.json"), { providers: { [provider]: providerModel } });
    }
    const sourceAuth = await readJson(join(sourceAgentDirectory, "auth.json"));
    if (sourceAuth?.[provider]) {
      await writeJson(join(agentDirectory, "auth.json"), { [provider]: sourceAuth[provider] });
    }
    return isolatedHome;
  } catch (error) {
    await rm(isolatedHome, { recursive: true, force: true });
    throw error;
  }
}

export function childModelEnvironment(environment, role, isolatedHome) {
  if (!isolatedHome) throw new Error("isolated child home is required");
  const scrubbed = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!isGitHubCredentialName(name) && ![
      "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "GH_CONFIG_DIR",
      "PI_CODING_AGENT_DIR", "PI_SESSION_FILE", "CBHQ_GUARD_AUDIT_LOG", "CBHQ_SESSION_LOG",
    ].includes(name)) {
      scrubbed[name] = value;
    }
  }
  scrubbed.HOME = isolatedHome;
  scrubbed.XDG_CONFIG_HOME = join(isolatedHome, ".config");
  scrubbed.XDG_CACHE_HOME = join(isolatedHome, ".cache");
  scrubbed.XDG_DATA_HOME = join(isolatedHome, ".local", "share");
  scrubbed.XDG_STATE_HOME = join(isolatedHome, ".local", "state");
  scrubbed.GH_CONFIG_DIR = join(isolatedHome, ".config", "gh");
  scrubbed.PI_CODING_AGENT_DIR = join(isolatedHome, ".pi", "agent");
  scrubbed.CBHQ_GUARD_AUDIT_LOG = join(isolatedHome, ".cbcode", "pi-audit.log");
  scrubbed.CBHQ_SESSION_LOG = join(isolatedHome, ".cbcode", "logs", "pi-session.log");
  scrubbed.FACTORY_CHILD_ROLE = role;
  scrubbed.CI = "1";
  scrubbed.GIT_TERMINAL_PROMPT = "0";
  scrubbed.GCM_INTERACTIVE = "never";
  scrubbed.GIT_CONFIG_COUNT = "3";
  scrubbed.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
  scrubbed.GIT_CONFIG_VALUE_0 = "disabled://factory-child";
  scrubbed.GIT_CONFIG_KEY_1 = "credential.helper";
  scrubbed.GIT_CONFIG_VALUE_1 = "";
  scrubbed.GIT_CONFIG_KEY_2 = "credential.interactive";
  scrubbed.GIT_CONFIG_VALUE_2 = "never";
  return scrubbed;
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") child.kill(signal);
  }
}

export async function runBoundedProcess({
  command,
  args,
  cwd,
  environment,
  role,
  timeoutMs,
  signal,
  maxOutputBytes = MAX_OUTPUT_BYTES,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("process timeout is required");

  const isolatedHome = await prepareIsolatedModelHome(environment);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: childModelEnvironment(environment, role, isolatedHome),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let outputExceeded = false;
      let timedOut = false;
      let killTimer;

      const stop = () => {
        terminateProcessGroup(child, "SIGTERM");
        killTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 1_000);
        killTimer.unref();
      };
      const abort = () => stop();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) stop();

      const append = (current, chunk) => {
        if (current.length + chunk.length > maxOutputBytes) {
          if (!outputExceeded) {
            outputExceeded = true;
            stop();
          }
          return current;
        }
        return Buffer.concat([current, chunk]);
      };
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeoutMs);
      timer.unref();

      child.on("error", (error) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (code, terminationSignal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        resolve({
          role,
          pid: child.pid,
          code,
          signal: terminationSignal,
          timedOut,
          outputExceeded,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
        });
      });
    });
  } finally {
    await rm(isolatedHome, { recursive: true, force: true });
  }
}

export function piInvocation(role, prompt) {
  const tools = role === "reviewer" ? "read,grep,find,ls" : "read,grep,find,ls,bash,edit,write";
  return {
    command: "cbcode",
    args: [
      "--agent", "pi", "--",
      "--print", "--no-session", "--no-extensions", "--no-skills",
      "--no-prompt-templates", "--no-themes", "--tools", tools,
      "--", prompt,
    ],
  };
}

export const factoryRunProcessConstants = Object.freeze({ maxOutputBytes: MAX_OUTPUT_BYTES });
