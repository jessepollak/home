import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");
const missing = "Pinned agent-browser is missing. Run bun install --frozen-lockfile in the Home worktree.";
const native = ["darwin", "linux"].includes(process.platform) && ["arm64", "x64"].includes(process.arch)
  ? resolve(repository, `node_modules/agent-browser/bin/agent-browser-${process.platform}-${process.arch}`)
  : null;
const binary = native && existsSync(native)
  ? native
  : resolve(repository, "node_modules/.bin/agent-browser");

try {
  accessSync(binary, constants.X_OK);
} catch {
  console.error(missing);
  process.exit(1);
}

const expected = (await import(resolve(repository, "package.json"))).default.devDependencies["agent-browser"];
const version = spawnSync(binary, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (version.error || version.status !== 0) {
  console.error("Pinned agent-browser failed its version check. Run bun install --frozen-lockfile.");
  process.exit(1);
}
const actual = version.stdout.trimEnd();
if (actual !== `agent-browser ${expected}`) {
  console.error(`Expected agent-browser ${expected}, found ${actual}. Run bun install --frozen-lockfile.`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
