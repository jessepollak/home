import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { executedAsScript } from "./bootstrap.mjs";

const USAGE = `Usage: bun run worktree:verify-resolution [--pr-head <ref>] [--base <ref>] [--allow <path>] [--help]

Compare the resolved worktree's changed files with the pull request patch's files.
Fail when the resolved head changes a file the PR never touched.

  --pr-head <ref>  Pre-rebase PR head (defaults to origin/<branch>)
  --base <ref>     Rebase target (defaults to origin/main)
  --allow <path>   Allow an intentional adaptation outside the PR patch (repeatable)
  --help          Show this help`;

function gitCommand(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  } catch (error) {
    const detail = error.stderr ? `: ${String(error.stderr).trim()}` : "";
    throw Object.assign(new Error(`Git command failed: git ${args.join(" ")}${detail}`), { status: error.status });
  }
}

function isAncestor(git, ancestor, descendant, cwd) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function branchName(git, cwd) {
  try {
    return git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).trim() || null;
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}

function refExists(git, ref, cwd) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function defaultPrHead(git, cwd) {
  const branch = branchName(git, cwd);
  if (branch && refExists(git, `origin/${branch}`, cwd)) return `origin/${branch}`;
  throw new Error("Could not find the pushed PR head; pass --pr-head <ref> explicitly.");
}

function paths(output) {
  return output.split("\0").filter(Boolean);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function resolutionReport({ cwd = process.cwd(), prHead, base = "origin/main", allow = [], git = gitCommand }) {
  cwd = git(["rev-parse", "--show-toplevel"], cwd).replace(/\n$/, "");
  for (const state of ["rebase-merge", "rebase-apply"]) {
    const statePath = git(["rev-parse", "--git-path", state], cwd).trim();
    if (existsSync(resolve(cwd, statePath))) {
      throw new Error("a rebase is in progress; finish it before verifying");
    }
  }
  if (git(["ls-files", "-u", "-z"], cwd)) {
    throw new Error("unresolved conflicts remain; finish the resolution before verifying");
  }
  if (!isAncestor(git, base, "HEAD", cwd)) {
    throw new Error(`HEAD does not contain ${base}; complete the rebase before verifying`);
  }
  prHead ??= defaultPrHead(git, cwd);
  if (isAncestor(git, prHead, "HEAD", cwd)) {
    throw new Error(`${prHead} is an ancestor of HEAD; pass the pre-resolution PR head of a rebased branch`);
  }
  const oldBase = git(["merge-base", prHead, base], cwd).trim();
  const prFiles = sortedUnique(paths(git(["diff", "--name-only", "--no-renames", "-z", oldBase, prHead], cwd)));
  const headFiles = sortedUnique([
    ...paths(git(["diff", "--name-only", "--no-renames", "-z", base, "HEAD"], cwd)),
    ...paths(git(["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"], cwd)),
    ...paths(git(["diff", "--name-only", "--no-renames", "-z"], cwd)),
    ...paths(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)),
  ].filter((path) => path !== ".factory" && !path.startsWith(".factory/")));
  const prSet = new Set(prFiles);
  const allowSet = new Set(allow.map((path) => path.replace(/^\.\//, "")));
  const outside = headFiles.filter((path) => !prSet.has(path));
  const allowed = outside.filter((path) => allowSet.has(path));
  const unexpected = outside.filter((path) => !allowSet.has(path));
  return { prHead, base, oldBase, prFiles, headFiles, allowed, unexpected };
}

export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  const options = { cwd, allow: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help") {
      log(USAGE);
      process.exitCode = 0;
      return;
    }
    if (!["--pr-head", "--base", "--allow"].includes(flag)) {
      error(`Unknown argument: ${flag}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      error(`Missing value for ${flag}\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    if (flag === "--allow") options.allow.push(value);
    else options[flag === "--base" ? "base" : "prHead"] = value;
  }
  try {
    const report = resolutionReport(options);
    for (const path of report.allowed) log(`Allowed outside the PR patch: ${path}`);
    if (report.unexpected.length > 0) {
      for (const path of report.unexpected) error(path);
      error(`Restore tracked files from ${report.base} (git restore --source=${report.base} --staged --worktree -- <path>) and delete untracked additions, unless this resolution intentionally adapted the file, in which case rerun with --allow <path>.`);
      process.exitCode = 1;
      return;
    }
    const count = report.headFiles.length;
    log(`Resolution changes only the PR's own files (${count} file${count === 1 ? "" : "s"}).`);
    process.exitCode = 0;
  } catch (failure) {
    error(failure.message);
    process.exitCode = 2;
  }
}

if (executedAsScript(import.meta.url)) main(process.argv.slice(2));
