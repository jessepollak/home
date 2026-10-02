import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolutionReport } from "../../worktree/verify-resolution.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

const SCRIPT = fileURLToPath(new URL("../../worktree/verify-resolution.mjs", import.meta.url));

function gitCommand(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: gitFixtureEnv(), stdio: ["ignore", "pipe", "pipe"] });
}

function fixture(t, { remote = false, rebase = true, dir = "repo" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "home-resolution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, dir);
  mkdirSync(cwd);
  const git = (args) => gitCommand(args, cwd);
  const write = (path, content) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = (message) => {
    git(["add", "-A"]);
    git(["commit", "-m", message]);
  };
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Resolution Test"]);
  git(["config", "user.email", "resolution-test@example.com"]);
  write(".gitignore", "ignored.txt\nignored/\n");
  write("pr.txt", "original PR file\n");
  write("main changed.txt", "original main file\n");
  write("main-deleted.txt", "original deleted file\n");
  commit("seed");
  const oldBase = git(["rev-parse", "HEAD"]).trim();
  if (remote) {
    const origin = join(root, "origin.git");
    gitCommand(["init", "--bare", "--initial-branch=main", origin], root);
    git(["remote", "add", "origin", origin]);
    git(["push", "origin", "main:main"]);
  }
  git(["checkout", "-b", "topic"]);
  write("pr.txt", "PR change\n");
  commit("change PR file");
  const oldHead = git(["rev-parse", "HEAD"]).trim();
  git(["branch", "pr-original"]);
  if (remote) git(["push", "origin", "topic:topic"]);
  git(["checkout", "main"]);
  write("main changed.txt", "new main content\n");
  write("main-added.txt", "new main file\n");
  rmSync(join(cwd, "main-deleted.txt"));
  commit("advance main");
  if (remote) git(["push", "origin", "main:main"]);
  else git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["checkout", "topic"]);
  if (rebase) git(["rebase", "origin/main"]);
  return {
    cwd, git, write, commit, oldBase, oldHead,
    report: (options = {}) => resolutionReport({ cwd, prHead: "pr-original", git: gitCommand, ...options }),
  };
}

function cli(cwd, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd, encoding: "utf8", env: gitFixtureEnv(), stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    if (typeof error.status !== "number") throw error;
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

test("detects a committed pre-rebase sweep and passes once main's files are restored", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.report(), {
    prHead: "pr-original", base: "origin/main", oldBase: f.oldBase,
    prFiles: ["pr.txt"], headFiles: ["pr.txt"], allowed: [], unexpected: [],
  });
  f.write("main changed.txt", f.git(["show", "pr-original:main changed.txt"]));
  f.write("main-deleted.txt", f.git(["show", "pr-original:main-deleted.txt"]));
  rmSync(join(f.cwd, "main-added.txt"));
  f.commit("sweep pre-rebase files into resolution");

  const swept = ["main changed.txt", "main-added.txt", "main-deleted.txt"];
  const report = f.report();
  assert.deepEqual(report.prFiles, ["pr.txt"]);
  assert.deepEqual(report.headFiles, [...swept, "pr.txt"]);
  assert.deepEqual(report.unexpected, swept);
  const failure = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, "");
  assert.deepEqual(failure.stderr.trim().split("\n"), [
    ...swept,
    "Restore tracked files from origin/main (git restore --source=origin/main --staged --worktree -- <path>) and delete untracked additions, unless this resolution intentionally adapted the file, in which case rerun with --allow <path>.",
  ]);

  assert.match(failure.stderr, /git restore --source=origin\/main/);
  assert.equal(existsSync(join(f.cwd, "main-deleted.txt")), true);
  f.git(["restore", "--source=origin/main", "--staged", "--worktree", "--", ...swept]);
  assert.equal(existsSync(join(f.cwd, "main-deleted.txt")), false);
  f.commit("restore main files");
  assert.deepEqual(f.report().unexpected, []);
  const success = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, "Resolution changes only the PR's own files (1 file).\n");
  assert.equal(success.stderr, "");
});

test("allows an intentional outside path with a space, deduplicating only actual exceptions", (t) => {
  const f = fixture(t);
  f.write("main changed.txt", "intentional adaptation\n");
  const allow = ["main changed.txt", "pr.txt", "main changed.txt", "unused.txt"];
  const report = f.report({ allow });
  assert.deepEqual(report.allowed, ["main changed.txt"]);
  assert.deepEqual(report.unexpected, []);
  assert.deepEqual(report.headFiles, ["main changed.txt", "pr.txt"]);
  assert.deepEqual(f.report().unexpected, ["main changed.txt"]);
  const result = cli(f.cwd, ["--pr-head", "pr-original", ...allow.flatMap((path) => ["--allow", path])]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Allowed outside the PR patch: main changed.txt\nResolution changes only the PR's own files (2 files).\n");
});

test("normalizes a leading ./ in an allowed outside path", (t) => {
  const f = fixture(t);
  f.write("main changed.txt", "intentional adaptation\n");
  const result = cli(f.cwd, ["--pr-head", "pr-original", "--allow", "./main changed.txt"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Allowed outside the PR patch: main changed.txt\nResolution changes only the PR's own files (2 files).\n");
});

test("reports an index-only outside change even when the working tree matches HEAD", (t) => {
  const f = fixture(t);
  const original = f.git(["show", "HEAD:main changed.txt"]);
  f.write("main changed.txt", "staged adaptation\n");
  f.git(["add", "main changed.txt"]);
  f.write("main changed.txt", original);
  assert.equal(f.git(["diff", "--name-only", "HEAD"]), "");
  assert.deepEqual(f.report().unexpected, ["main changed.txt"]);
  const result = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split("\n")[0], "main changed.txt");
});

test("reports root-level untracked additions when invoked from a nested directory", (t) => {
  const f = fixture(t);
  f.write("outside.txt", "untracked addition\n");
  const nested = join(f.cwd, "nested", "deeper");
  mkdirSync(nested, { recursive: true });
  const result = cli(nested, ["--pr-head", "pr-original"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split("\n")[0], "outside.txt");
});

test("keeps a repository root that ends in whitespace", (t) => {
  for (const dir of ["repo ", "repo\r"]) {
    const f = fixture(t, { dir });
    f.write("main changed.txt", f.git(["show", "pr-original:main changed.txt"]));
    f.commit("sweep the main file");
    const result = cli(f.cwd, ["--pr-head", "pr-original"]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.split("\n")[0], "main changed.txt");
  }
});

test("unions committed, staged, unstaged and untracked files but excludes ignored files and .factory contents", (t) => {
  const f = fixture(t);
  f.write(".factory/tracked.txt", "tracked metadata\n");
  f.commit("add metadata");
  f.write(".factory/tracked.txt", "unstaged metadata\n");
  f.write(".factory/untracked.txt", "untracked metadata\n");
  f.write(".factory/staged.txt", "staged metadata\n");
  f.write("staged.txt", "staged addition\n");
  f.git(["add", "staged.txt", ".factory/staged.txt"]);
  f.write("main changed.txt", "unstaged adaptation\n");
  f.write("new file.txt", "untracked addition\n");
  f.write(".factory-public.txt", "not metadata\n");
  f.write("ignored.txt", "ignored file\n");
  f.write("ignored/nested.txt", "ignored directory\n");
  f.write("pr.txt", "further PR change\n");
  const report = f.report();
  assert.deepEqual(report.headFiles, [".factory-public.txt", "main changed.txt", "new file.txt", "pr.txt", "staged.txt"]);
  assert.deepEqual(report.unexpected, [".factory-public.txt", "main changed.txt", "new file.txt", "staged.txt"]);
});

test("excludes .factory itself whether untracked or committed", (t) => {
  const f = fixture(t);
  f.write(".factory", "metadata\n");
  assert.deepEqual(f.report().headFiles, ["pr.txt"]);
  f.commit("add metadata file");
  assert.deepEqual(f.report().headFiles, ["pr.txt"]);
});

test("rejects a base that HEAD does not contain before attempting PR-head detection", (t) => {
  const f = fixture(t, { rebase: false });
  assert.throws(() => f.report(), /HEAD does not contain origin\/main; complete the rebase before verifying/);
  const result = cli(f.cwd);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "HEAD does not contain origin/main; complete the rebase before verifying\n");
});

test("rejects a first-commit rebase conflict even when HEAD contains the base", (t) => {
  const f = fixture(t, { rebase: false });
  f.git(["checkout", "-b", "conflicting-topic", f.oldBase]);
  f.write("main changed.txt", "conflicting PR change\n");
  f.commit("change main file on PR");
  assert.throws(() => f.git(["rebase", "origin/main"]), (error) => error.status === 1);
  assert.equal(f.git(["rev-parse", "HEAD"]), f.git(["rev-parse", "origin/main"]));
  assert.notEqual(f.git(["ls-files", "-u", "-z"]), "");
  const result = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "a rebase is in progress; finish it before verifying\n");
});

test("rejects unresolved merge conflicts outside a rebase", (t) => {
  const f = fixture(t);
  f.write("main changed.txt", "topic adaptation\n");
  f.commit("adapt main file on topic");
  f.git(["checkout", "-b", "conflicting-main", "origin/main"]);
  f.write("main changed.txt", "conflicting main change\n");
  f.commit("change main file independently");
  f.git(["checkout", "topic"]);
  assert.throws(() => f.git(["merge", "conflicting-main"]), (error) => error.status === 1);
  const result = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "unresolved conflicts remain; finish the resolution before verifying\n");
});

test("rejects --pr-head refs that are HEAD or an ancestor of HEAD", (t) => {
  const f = fixture(t);
  f.write("main changed.txt", "outside adaptation\n");
  f.commit("adapt an outside file");
  for (const prHead of ["HEAD", "origin/main"]) {
    const result = cli(f.cwd, ["--pr-head", prHead]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${prHead} is an ancestor of HEAD; pass the pre-resolution PR head of a rebased branch\n`);
  }
});

test("uses explicit --pr-head and --base even with detached HEAD and no automatic candidates", (t) => {
  const f = fixture(t);
  f.git(["checkout", "--detach"]);
  f.git(["update-ref", "-d", "ORIG_HEAD"]);
  f.git(["update-ref", "-d", "refs/remotes/origin/main"]);
  assert.deepEqual(f.report({ base: "main" }).unexpected, []);
  const result = cli(f.cwd, ["--pr-head", "pr-original", "--base", "main"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Resolution changes only the PR's own files (1 file).\n");
  const automatic = cli(f.cwd, ["--base", "main"]);
  assert.equal(automatic.status, 2);
  assert.match(automatic.stderr, /Could not find the pushed PR head; pass --pr-head <ref> explicitly/);
});

test("defaults to origin/<branch> when the branch has a pushed head", (t) => {
  const f = fixture(t, { remote: true });
  assert.equal(f.git(["rev-parse", "origin/topic"]).trim(), f.oldHead);
  const report = f.report({ prHead: undefined });
  assert.equal(report.prHead, "origin/topic");
  assert.equal(report.oldBase, f.oldBase);
  assert.deepEqual(report.prFiles, ["pr.txt"]);
  assert.deepEqual(report.unexpected, []);
  const result = cli(f.cwd);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Resolution changes only the PR's own files (1 file).\n");
});

test("requires --pr-head when the branch has no pushed head", (t) => {
  const f = fixture(t);
  const automatic = cli(f.cwd);
  assert.equal(automatic.status, 2);
  assert.equal(automatic.stdout, "");
  assert.equal(automatic.stderr, "Could not find the pushed PR head; pass --pr-head <ref> explicitly.\n");
  const explicit = cli(f.cwd, ["--pr-head", "pr-original"]);
  assert.equal(explicit.status, 0);
  assert.equal(explicit.stderr, "");
});

test("requires --pr-head when the pushed head is an ancestor of HEAD", (t) => {
  const f = fixture(t);
  f.git(["update-ref", "refs/remotes/origin/topic", "HEAD"]);
  const result = cli(f.cwd);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "origin/topic is an ancestor of HEAD; pass the pre-resolution PR head of a rebased branch\n");
});

test("reports invalid arguments with usage and explains the check in --help", (t) => {
  const f = fixture(t);
  for (const args of [["--unknown"], ["unexpected"], ["--pr-head"], ["--base"], ["--allow"], ["--allow", "--base", "main"]]) {
    const result = cli(f.cwd, args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage: bun run worktree:verify-resolution/);
  }
  const help = cli(f.cwd, ["--help"]);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /resolved worktree's changed files with the pull request patch's files/);
  assert.match(help.stdout, /resolved head changes a file the PR never touched/);
  assert.match(help.stdout, /defaults to origin\/<branch>/);
});
