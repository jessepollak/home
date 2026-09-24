import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function pinnedAgentBrowser(repositoryRoot: string, env?: Record<string, string | undefined>): string {
  const binary = resolve(repositoryRoot, "node_modules/.bin/agent-browser");
  const installHint = "Run bun install --frozen-lockfile in this Home worktree.";
  if (!existsSync(binary)) throw new Error(`Pinned agent-browser is missing at ${binary}. ${installHint}`);
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
    devDependencies: { "agent-browser": string };
  };
  const expected = `agent-browser ${packageJson.devDependencies["agent-browser"]}`;
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({ cmd: [binary, "--version"], cwd: repositoryRoot, env, stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error(`Pinned agent-browser could not run its version check. ${installHint}`);
  }
  const actual = result.stdout?.toString().trim() ?? "";
  if (result.exitCode !== 0 || actual !== expected) {
    throw new Error(`Expected ${expected}, found ${actual || result.stderr?.toString().trim() || `exit ${result.exitCode}`}. ${installHint}`);
  }
  return binary;
}
