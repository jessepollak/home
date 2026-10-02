import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BROWSER_REINSTALL_COMMAND,
  nativeBrowserBinary,
  pinnedBrowserUnavailableMessage,
} from "./pinned-agent-browser.mjs";

const repository = resolve(import.meta.dir, "../..");
const native = nativeBrowserBinary(repository);
const binary = native && existsSync(native)
  ? native
  : resolve(repository, "node_modules/.bin/agent-browser");

try {
  accessSync(binary, constants.X_OK);
} catch {
  console.error(pinnedBrowserUnavailableMessage({ binary, native }));
  process.exit(1);
}

const expected = (await import(resolve(repository, "package.json"))).default.devDependencies["agent-browser"];
const version = spawnSync(binary, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
if (version.error || version.status !== 0) {
  console.error(`Pinned agent-browser failed its version check. Reinstall it with \`${BROWSER_REINSTALL_COMMAND}\`.`);
  process.exit(1);
}
const actual = version.stdout.trimEnd();
if (actual !== `agent-browser ${expected}`) {
  console.error(`Expected agent-browser ${expected}, found ${actual}. Reinstall it with \`${BROWSER_REINSTALL_COMMAND}\`.`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
