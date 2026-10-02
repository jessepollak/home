import { accessSync, chmodSync, constants, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const BROWSER_REPAIR_COMMAND = "bun run worktree:bootstrap";
export const BROWSER_REINSTALL_COMMAND = "rm -rf node_modules/agent-browser && bun install --frozen-lockfile";

export function nativeBrowserBinary(root, platform = process.platform, arch = process.arch) {
  if (!["darwin", "linux"].includes(platform) || !["arm64", "x64"].includes(arch)) return undefined;
  return join(root, "node_modules", "agent-browser", "bin", `agent-browser-${platform}-${arch}`);
}

export function browserBinaryIsExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function repairPinnedBrowser(root, { platform = process.platform, arch = process.arch } = {}) {
  const binary = nativeBrowserBinary(root, platform, arch);
  if (!binary || !existsSync(binary)) return { state: "absent" };
  const relativePath = relative(root, binary);
  if (!statSync(binary).isFile()) {
    throw new Error(`Pinned agent-browser at ${relativePath} is not a regular executable file. Reinstall it with \`${BROWSER_REINSTALL_COMMAND}\`.`);
  }
  if (browserBinaryIsExecutable(binary)) return { state: "ready", binary };
  try {
    chmodSync(binary, 0o755);
    if (!browserBinaryIsExecutable(binary)) throw new Error("executable permission check failed");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Pinned agent-browser at ${relativePath} is not executable and could not be repaired (${reason}). Repair it with \`chmod +x ${relativePath}\` or reinstall with \`${BROWSER_REINSTALL_COMMAND}\`.`);
  }
  return { state: "repaired", binary };
}

export function assertPinnedBrowserReady(root, { platform = process.platform, arch = process.arch } = {}) {
  const binary = nativeBrowserBinary(root, platform, arch);
  if (!binary || !existsSync(join(root, "node_modules", "agent-browser", "package.json"))) return undefined;
  if (existsSync(binary) && browserBinaryIsExecutable(binary)) return binary;
  throw new Error(`Pinned agent-browser is installed but ${relative(root, binary)} is missing or not executable. Reinstall it with \`${BROWSER_REINSTALL_COMMAND}\`.`);
}

export function pinnedBrowserUnavailableMessage({ binary, native }) {
  if (native !== undefined && binary === native) {
    return `Pinned agent-browser is installed but not executable. Run \`${BROWSER_REPAIR_COMMAND}\` in this Home worktree to repair it.`;
  }
  return `Pinned agent-browser is missing. Run \`${BROWSER_REPAIR_COMMAND}\` in this Home worktree to install dependencies.`;
}
