import { spawn } from "node:child_process";

const GITHUB_CREDENTIAL_NAMES = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;

function isGitHubCredentialName(name) {
  return GITHUB_CREDENTIAL_NAMES.has(name) ||
    (/^(?:GH|GITHUB)_/.test(name) && /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/.test(name)) ||
    name === "GIT_ASKPASS" || name === "SSH_ASKPASS";
}

export function childModelEnvironment(environment, role) {
  const scrubbed = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!isGitHubCredentialName(name)) scrubbed[name] = value;
  }
  scrubbed.FACTORY_CHILD_ROLE = role;
  scrubbed.CI = "1";
  scrubbed.GIT_CONFIG_COUNT = "1";
  scrubbed.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
  scrubbed.GIT_CONFIG_VALUE_0 = "disabled://factory-child";
  return scrubbed;
}

export function runBoundedProcess({
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

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childModelEnvironment(environment, role),
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let outputExceeded = false;
    let timedOut = false;

    const append = (current, chunk) => {
      if (current.length + chunk.length > maxOutputBytes) {
        outputExceeded = true;
        child.kill("SIGTERM");
        return current;
      }
      return Buffer.concat([current, chunk]);
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    timer.unref();

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
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
