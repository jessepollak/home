import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BOOTSTRAP_COMMAND = "bun run worktree:bootstrap";
export const COPY_ENV_FLAG = "--copy-env";

const FALLBACK_REQUIRED_PACKAGES = ["next", "react", "react-dom"];
function stripTrailingCommas(text) {
  let inString = false;
  let escaped = false;
  const output = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === ",") {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    output.push(character);
  }
  return output.join("");
}

export function lockfileResolutions(root) {
  let parsed;
  try {
    parsed = JSON.parse(stripTrailingCommas(readFileSync(join(root, "bun.lock"), "utf8")));
  } catch (error) {
    return { state: error?.code === "ENOENT" ? "missing" : "unreadable" };
  }
  const packages = parsed?.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) return { state: "unreadable" };
  const versions = new Map();
  const resolutions = new Map();
  for (const [key, value] of Object.entries(packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") continue;
    const specifier = value[0];
    const separator = specifier.lastIndexOf("@");
    if (separator <= 0 || !/^\d/.test(specifier.slice(separator + 1))) continue;
    const name = specifier.slice(0, separator);
    const version = specifier.slice(separator + 1);
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(version);
    const parent = key === name ? "" : key.endsWith(`/${name}`) ? key.slice(0, -name.length - 1) : undefined;
    if (parent === undefined) continue;
    if (!resolutions.has(parent)) resolutions.set(parent, new Map());
    resolutions.get(parent).set(name, version);
  }
  return { state: "ok", versions, resolutions };
}
export function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export function executedAsScript(moduleUrl, argv = process.argv) {
  if (!argv[1]) return false;
  try {
    return realpathSync(resolve(argv[1])) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

export function inspectPath(path) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing" };
    throw error;
  }
  if (stats.isSymbolicLink()) {
    let target;
    try {
      target = readlinkSync(path);
    } catch {
      target = undefined;
    }
    return { state: "symlink", target };
  }
  if (!stats.isDirectory()) return { state: "not-directory" };
  return { state: "directory" };
}

export function describeProblem(problem) {
  if (problem.state === "symlink") {
    return problem.target ? `a symlink to ${problem.target}` : "a symlink";
  }
  if (problem.state === "missing") return "missing";
  if (problem.state === "incomplete") return "incomplete (a required package is missing)";
  if (problem.state === "stale") {
    return `stale (installed ${problem.installed}; the lockfile resolves ${problem.expected.join(", ")})`;
  }
  if (problem.state === "lockfile-missing") return "missing (dependency versions cannot be verified)";
  if (problem.state === "lockfile-unreadable") return "unreadable (dependency versions cannot be verified)";
  if (problem.state === "lockfile-mismatched") return "out of sync with this worktree's dependencies (dependency versions cannot be verified)";
  return "not a directory";
}

export function declaredDependencies(root) {
  const rootModules = join(root, "node_modules");
  const scopes = [
    {
      label: "node_modules",
      workspace: "",
      directory: rootModules,
      manifest: join(root, "package.json"),
    },
    {
      label: "apps/web/node_modules",
      workspace: "apps/web",
      directory: join(root, "apps/web/node_modules"),
      hoistedTo: rootModules,
      manifest: join(root, "apps/web/package.json"),
    },
  ];
  const declared = [];
  for (const scope of scopes) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(scope.manifest, "utf8"));
    } catch {
      continue;
    }
    const names = new Set();
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(parsed[field] ?? {})) names.add(name);
    }
    declared.push({ ...scope, names });
  }
  return declared;
}

function packageResolves(scope, name) {
  const directories = scope.hoistedTo ? [scope.directory, scope.hoistedTo] : [scope.directory];
  return directories.some((directory) => existsSync(join(directory, name, "package.json")));
}

function installedPackage(scope, name) {
  const directories = scope.hoistedTo ? [scope.directory, scope.hoistedTo] : [scope.directory];
  for (const directory of directories) {
    const manifest = join(directory, name, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      const version = JSON.parse(readFileSync(manifest, "utf8")).version;
      return { directory, version: typeof version === "string" ? version : undefined };
    } catch {
      return { directory, version: undefined };
    }
  }
  return undefined;
}

export function dependencyProblems(root) {
  const problems = [];
  const rootModules = join(root, "node_modules");
  const rootState = inspectPath(rootModules);
  if (rootState.state !== "directory") {
    problems.push({ absolute: rootModules, relative: "node_modules", ...rootState });
  }
  const app = join(root, "apps/web");
  if (!existsSync(app)) {
    problems.push({ absolute: app, relative: "apps/web", state: "missing" });
    return problems;
  }
  const appModules = join(app, "node_modules");
  const appState = inspectPath(appModules);
  if (appState.state !== "directory") {
    problems.push({ absolute: appModules, relative: "apps/web/node_modules", ...appState });
    return problems;
  }
  const lockfile = lockfileResolutions(root);
  if (lockfile.state !== "ok") {
    problems.push({
      absolute: join(root, "bun.lock"),
      relative: "bun.lock",
      state: lockfile.state === "missing" ? "lockfile-missing" : "lockfile-unreadable",
    });
  }
  const declared = declaredDependencies(root).filter((scope) => scope.names.size > 0);
  const fallback = {
    label: "apps/web/node_modules",
    workspace: "apps/web",
    directory: appModules,
    hoistedTo: rootModules,
    names: new Set(FALLBACK_REQUIRED_PACKAGES),
  };
  const scopes = declared.length > 0 ? declared : [fallback];
  const names = new Set(scopes.flatMap((scope) => [...scope.names]));
  const lockfileMismatched = lockfile.state === "ok" && names.size > 0 && ![...names].some((name) => lockfile.versions.has(name));
  if (lockfileMismatched) {
    problems.push({ absolute: join(root, "bun.lock"), relative: "bun.lock", state: "lockfile-mismatched" });
  }
  for (const scope of scopes) {
    for (const name of scope.names) {
      if (!packageResolves(scope, name)) {
        problems.push({
          absolute: join(scope.directory, name),
          relative: `${scope.label}/${name}`,
          state: "incomplete",
        });
        continue;
      }
      if (lockfile.state !== "ok" || lockfileMismatched) continue;
      const versions = lockfile.versions.get(name);
      if (!versions) continue;
      const installed = installedPackage(scope, name);
      if (installed?.version === undefined) continue;
      const selectedVersion = lockfile.resolutions.get(scope.workspace)?.get(name) ?? lockfile.resolutions.get("")?.get(name);
      const expected = selectedVersion === undefined ? [...versions].sort() : [selectedVersion];
      if (!expected.includes(installed.version)) {
        problems.push({
          absolute: join(scope.directory, name),
          relative: `${scope.label}/${name}`,
          state: "stale",
          installed: installed.version,
          expected,
        });
      }
    }
  }
  return problems;
}

export function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return { status: result.status ?? 1, error: result.error };
}

export function installDependencies(root, run = runCommand, problems = dependencyProblems(root), { force = false } = {}) {
  for (const problem of problems) {
    if (problem.state === "symlink" || problem.state === "not-directory") {
      unlinkSync(problem.absolute);
    }
  }
  if (problems.length === 0 && !force) return { state: "present", problems: [] };
  const result = run("bun", ["install", "--frozen-lockfile"], root);
  if (result.error) throw new Error(`bun install could not start: ${String(result.error)}`);
  if (result.status !== 0) {
    throw new Error(`\`bun install --frozen-lockfile\` failed with exit code ${result.status}.`);
  }
  const remaining = dependencyProblems(root);
  if (remaining.length > 0) {
    const list = remaining.map((problem) => problem.relative).join(", ");
    const verb = remaining.length === 1 ? "is" : "are";
    const recovery = "rm -rf node_modules && bun install --frozen-lockfile";
    throw new Error(`A frozen install finished but ${list} ${verb} still not ready. Repair those paths and rerun (restore bun.lock from Git when it is listed), or reinstall from scratch with ${recovery}.`);
  }
  return problems.length > 0 ? { state: "installed", problems } : { state: "verified", problems: [] };
}

export function gitCommand(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function gitText(git, args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function revCount(git, range, root) {
  const text = gitText(git, ["rev-list", "--count", range], root);
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  return Number(text);
}

export function resolveRemoteRef(root, git = gitCommand) {
  const symbolic = gitText(git, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root);
  if (symbolic) return symbolic;
  for (const candidate of ["origin/main", "origin/master"]) {
    if (gitText(git, ["rev-parse", "--verify", "--quiet", candidate], root)) return candidate;
  }
  return undefined;
}

export function baseStatus(root, git = gitCommand) {
  if (!gitText(git, ["rev-parse", "--verify", "--quiet", "HEAD"], root)) {
    return { state: "unknown", reason: "not a git repository" };
  }
  const remote = resolveRemoteRef(root, git);
  if (!remote) return { state: "unknown", reason: "no remote default branch" };
  if (!gitText(git, ["rev-parse", "--verify", "--quiet", remote], root)) {
    return { state: "unknown", reason: `cannot resolve ${remote}` };
  }
  const behind = revCount(git, `HEAD..${remote}`, root);
  const ahead = revCount(git, `${remote}..HEAD`, root);
  if (behind === undefined || ahead === undefined) {
    return { state: "unknown", reason: `cannot count commits against ${remote}` };
  }
  if (behind > 0 && ahead > 0) return { state: "diverged", remote, behind, ahead };
  if (behind > 0) return { state: "behind", remote, behind, ahead };
  if (ahead > 0) return { state: "ahead", remote, behind, ahead };
  return { state: "current", remote, behind: 0, ahead: 0 };
}

export function baseSummary(status) {
  if (status.state === "behind") return `${status.behind} commit(s) behind ${status.remote}; merge or rebase before opening a pull request`;
  if (status.state === "diverged") return `diverged from ${status.remote} (${status.behind} behind, ${status.ahead} ahead)`;
  if (status.state === "ahead") return `ahead of ${status.remote} by ${status.ahead} commit(s)`;
  if (status.state === "current") return `up to date with ${status.remote}`;
  return `unknown (${status.reason})`;
}

export function primaryWorktree(root, git = gitCommand) {
  const output = gitText(git, ["worktree", "list", "--porcelain"], root);
  if (!output) return undefined;
  const line = output.split("\n").find((entry) => entry.startsWith("worktree "));
  return line ? line.slice("worktree ".length).trim() : undefined;
}

function envFileIsUsable(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function copyWorktreeEnv(root, git = gitCommand, { copy = false } = {}) {
  const target = join(root, "apps/web/.env.local");
  let targetExists = false;
  try {
    targetExists = lstatSync(target) !== undefined;
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    if (envFileIsUsable(target)) return { status: "present", target };
    return { status: "absent", target, reason: "target exists but is not a regular file" };
  }
  if (!copy) {
    return { status: "skipped", target, reason: `env copy is opt-in; pass ${COPY_ENV_FLAG}` };
  }
  const primary = primaryWorktree(root, git);
  if (!primary) return { status: "absent", target, reason: "no primary worktree" };
  const source = join(primary, "apps/web/.env.local");
  if (!envFileIsUsable(source)) {
    return { status: "absent", target, reason: "no usable source file in the primary checkout" };
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (envFileIsUsable(target)) return { status: "present", target };
    return { status: "absent", target, reason: "target appeared during copy but is not a regular file" };
  }
  chmodSync(target, 0o600);
  return { status: "copied", target, source };
}

export function bootstrap(root, { git = gitCommand, run = runCommand, log = console.log, copyEnv = false } = {}) {
  const problems = dependencyProblems(root);
  for (const problem of problems) {
    log(`worktree: ${problem.relative} is ${describeProblem(problem)}`);
  }
  const dependencies = installDependencies(root, run, problems, { force: true });
  if (dependencies.state === "installed") {
    log("worktree: applied the lockfile with `bun install --frozen-lockfile`");
  } else if (dependencies.state === "verified") {
    log("worktree: dependencies already match bun.lock");
  }
  const base = baseStatus(root, git);
  log(`worktree: base ${baseSummary(base)}`);
  if (base.state === "behind" || base.state === "diverged") {
    log("worktree: this command never rebases; update the base yourself before opening a pull request");
  }
  const env = copyWorktreeEnv(root, git, { copy: copyEnv });
  if (env.status === "copied") {
    log("worktree: copied apps/web/.env.local from the primary checkout with mode 600");
  } else if (env.status === "skipped") {
    log(`worktree: left apps/web/.env.local alone (${env.reason})`);
  } else if (env.status === "absent") {
    log(`worktree: no apps/web/.env.local to copy (${env.reason})`);
  }
  const summary = `worktree ready: dependencies ${dependencies.state}; base ${baseSummary(base)}; env ${env.status}`;
  log(summary);
  return { dependencies, base, env, summary };
}

if (executedAsScript(import.meta.url)) {
  try {
    bootstrap(repositoryRoot(), { copyEnv: process.argv.slice(2).includes(COPY_ENV_FLAG) });
  } catch (error) {
    console.error(`worktree bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
