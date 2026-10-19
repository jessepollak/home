import { lstatSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const GENERATED_TYPE_DIRS = ["apps/web/.next/dev/types", "apps/web/.next/types"];
const DEV_LOCK = "apps/web/.next/dev/lock";
const SOURCE_EXTENSIONS = [".tsx", ".d.ts", ".ts", ".jsx", ".js", ".mjs"];

function generatedFiles(directory) {
  let stats;
  try {
    stats = lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!stats.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return generatedFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function decodeSpecifier(specifier) {
  const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  return specifier.replace(/\\(?:u([\da-fA-F]{4})|(.))/g, (_, unicode, character) => unicode === undefined ? escapes[character] ?? character : String.fromCodePoint(Number.parseInt(unicode, 16)));
}

export function staleTypeReferences(root) {
  const stale = [];
  for (const directory of GENERATED_TYPE_DIRS) {
    for (const file of generatedFiles(join(root, directory))) {
      const content = readFileSync(file, "utf8");
      const specifiers = /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)(?:"((?:[^"\\\r\n]|\\.)*\.js)"|'((?:[^'\\\r\n]|\\.)*\.js)')/g;
      for (const match of content.matchAll(specifiers)) {
        const module = decodeSpecifier(match[1] ?? match[2]);
        if (!/^\.{1,2}\//.test(module)) continue;
        const target = resolve(dirname(file), module.slice(0, -3));
        if (SOURCE_EXTENSIONS.some((extension) => isFile(`${target}${extension}`))) continue;
        stale.push({ directory, file: relative(root, file), module, target: relative(root, target) });
      }
    }
  }
  return stale;
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export function devServerState(root, { isAlive = pidIsAlive } = {}) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, DEV_LOCK), "utf8"));
  } catch (error) {
    return { state: error.code === "ENOENT" ? "stopped" : "unknown" };
  }
  if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0 || !Number.isInteger(lock.port) || lock.port < 1 || lock.port > 65535) {
    return { state: "unknown" };
  }
  const { pid, port } = lock;
  if (!isAlive(pid)) return { state: "abandoned", pid };
  return { state: "running", pid, port };
}

export function pruneStaleNextTypes(root, {
  devServer,
  isAlive = pidIsAlive,
  recheckDevServer = () => devServerState(root, { isAlive }),
} = {}) {
  const stale = staleTypeReferences(root);
  if (stale.length === 0) return { state: "ready", stale };
  devServer ??= devServerState(root, { isAlive });
  if (devServer.state !== "stopped" && devServer.state !== "abandoned") return { state: "in-use", stale, devServer };
  const directories = [...new Set(stale.map((entry) => entry.directory))];
  const removedDirectories = [];
  const check = () => {
    const fresh = recheckDevServer();
    if (fresh.state === "stopped" || (fresh.state === "abandoned" && devServer.state === "abandoned" && fresh.pid === devServer.pid)) return;
    return {
      state: "in-use",
      stale,
      devServer: fresh,
      removedDirectories: [...removedDirectories],
      keptDirectories: directories.filter((directory) => !removedDirectories.includes(directory)),
    };
  };
  for (let index = 0; index < directories.length; index++) {
    const inUse = check();
    if (inUse) return inUse;
  }
  for (const directory of directories) {
    const inUse = check();
    if (inUse) return inUse;
    rmSync(join(root, directory), { recursive: true, force: true });
    removedDirectories.push(directory);
  }
  return { state: "pruned", stale, directories };
}

export function describeStaleReference(entry) {
  return `${entry.file} references ${entry.target}, which no longer exists`;
}
