import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { preflightProblemLines } from "../preflight.mjs";
import {
  baseStatus,
  baseSummary,
  bootstrap,
  copyWorktreeEnv,
  dependencyProblems,
  describeProblem,
  inspectPath,
  installDependencies,
} from "../../worktree/bootstrap.mjs";

const BOOTSTRAP_HINT = "bun run worktree:bootstrap";

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), "home-worktree-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function installedApp(root) {
  mkdirSync(join(root, "node_modules"), { recursive: true });
  const packages = { next: ["next@16.1.0"], react: ["react@19.2.8"], "react-dom": ["react-dom@19.2.8"] };
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages }));
  for (const [name, version] of [["next", "16.1.0"], ["react", "19.2.8"], ["react-dom", "19.2.8"]]) {
    const directory = join(root, "apps/web/node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
  }
}

function setAppVersion(root, name, version) {
  const directory = join(root, "apps/web/node_modules", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
}

function scriptedGit(responses) {
  return (args) => {
    const value = responses[args.join(" ")];
    if (value === undefined) return { status: 1, stdout: "" };
    return { status: 0, stdout: value };
  };
}

test("inspectPath distinguishes a directory, file, missing path and symlink", (t) => {
  const root = scratch(t);
  const real = join(root, "real");
  mkdirSync(real);
  const file = join(root, "file");
  writeFileSync(file, "");
  const link = join(root, "link");
  symlinkSync(real, link);

  assert.deepEqual(inspectPath(real), { state: "directory" });
  assert.deepEqual(inspectPath(file), { state: "not-directory" });
  assert.deepEqual(inspectPath(join(root, "absent")), { state: "missing" });
  assert.equal(inspectPath(link).state, "symlink");
  assert.equal(inspectPath(link).target, real);
});

test("dependencyProblems reports a missing or symlinked root tree and a symlinked app tree", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "apps/web"), { recursive: true });
  assert.deepEqual(
    dependencyProblems(root).map((problem) => problem.relative),
    ["node_modules", "apps/web/node_modules"],
  );

  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, join(root, "node_modules"));
  symlinkSync(other, join(root, "apps/web/node_modules"));
  const problems = dependencyProblems(root);
  assert.deepEqual(
    problems.map((problem) => problem.relative).sort(),
    ["apps/web/node_modules", "node_modules"],
  );
  assert.ok(problems.every((problem) => problem.state === "symlink"));
  assert.ok(describeProblem(problems[0]).startsWith("a symlink"));
});

test("a missing app dependency tree is incomplete", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "apps/web"), { recursive: true });
  const problems = dependencyProblems(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].relative, "apps/web/node_modules");
  assert.equal(problems[0].state, "missing");
});

test("an app tree missing a required package is incomplete", (t) => {
  const root = scratch(t);
  installedApp(root);
  rmSync(join(root, "apps/web/node_modules/next"), { recursive: true, force: true });
  const problems = dependencyProblems(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].relative, "apps/web/node_modules/next");
  assert.equal(problems[0].state, "incomplete");
  assert.match(describeProblem(problems[0]), /incomplete/);

  const next = join(root, "apps/web/node_modules/next");
  mkdirSync(next, { recursive: true });
  writeFileSync(join(next, "package.json"), "{}");
  assert.deepEqual(dependencyProblems(root), []);

  rmSync(join(root, "apps/web/node_modules/react"), { recursive: true, force: true });
  assert.deepEqual(
    dependencyProblems(root).map((problem) => problem.relative),
    ["apps/web/node_modules/react"],
  );
});
test("dependencyProblems checks the workspace's declared dependencies", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(
    join(root, "apps/web/package.json"),
    JSON.stringify({ dependencies: { next: "1", oxlint: "1" } }),
  );
  assert.deepEqual(
    dependencyProblems(root).map((problem) => problem.relative),
    ["apps/web/node_modules/oxlint"],
  );

  const oxlint = join(root, "apps/web/node_modules/oxlint");
  mkdirSync(oxlint, { recursive: true });
  writeFileSync(join(oxlint, "package.json"), "{}");
  assert.deepEqual(dependencyProblems(root), []);
});
test("a root-declared package never resolves from the app tree", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "node_modules"), { recursive: true });
  installedApp(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "agent-browser": "0.38.1" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: { "agent-browser": ["agent-browser@0.38.1"] } }));
  const appCopy = join(root, "apps/web/node_modules/agent-browser");
  mkdirSync(appCopy, { recursive: true });
  writeFileSync(join(appCopy, "package.json"), "{}");
  assert.deepEqual(
    dependencyProblems(root).map((problem) => problem.relative),
    ["node_modules/agent-browser"],
  );

  const rootCopy = join(root, "node_modules/agent-browser");
  mkdirSync(rootCopy, { recursive: true });
  writeFileSync(join(rootCopy, "package.json"), "{}");
  assert.deepEqual(dependencyProblems(root), []);
});

test("an app-declared package resolves from the hoisted root tree", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "node_modules/next"), { recursive: true });
  writeFileSync(join(root, "node_modules/next/package.json"), "{}");
  mkdirSync(join(root, "apps/web/node_modules"), { recursive: true });
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "1" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: { next: ["next@16.1.0"] } }));
  assert.deepEqual(dependencyProblems(root), []);
});
test("the fallback package set applies when no manifest declares dependencies", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(root, "apps/web/node_modules"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "apps/web/package.json"), "{}");
  assert.deepEqual(
    dependencyProblems(root).map((problem) => problem.relative),
    ["bun.lock", "apps/web/node_modules/next", "apps/web/node_modules/react", "apps/web/node_modules/react-dom"],
  );

  installedApp(root);
  assert.deepEqual(dependencyProblems(root), []);
});

test("a bun lockfile with trailing commas reports a stale declared package until its version matches", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  writeFileSync(join(root, "bun.lock"), '{ "packages": { "next@16.1.0": ["next@16.1.0",], }, "detail": "comma ,} inside string", }');
  setAppVersion(root, "next", "15.0.0");
  const [problem] = dependencyProblems(root);
  assert.deepEqual(dependencyProblems(root), [{
    absolute: join(root, "apps/web/node_modules/next"),
    relative: "apps/web/node_modules/next",
    state: "stale",
    installed: "15.0.0",
    expected: ["16.1.0"],
  }]);
  assert.equal(describeProblem(problem), "stale (installed 15.0.0; the lockfile resolves 16.1.0)");
  setAppVersion(root, "next", "16.1.0");
  assert.deepEqual(dependencyProblems(root), []);
});

test("the top-level lockfile resolution wins over other versions for a nested installed copy", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { "lru-cache": "10" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: {
    "lru-cache": ["lru-cache@10.4.2"],
    "lru-cache@10.4.3": ["lru-cache@10.4.3"],
  } }));
  setAppVersion(root, "lru-cache", "10.4.2");
  assert.deepEqual(dependencyProblems(root), []);
  for (const version of ["10.4.3", "9.0.0"]) {
    setAppVersion(root, "lru-cache", version);
    assert.deepEqual(dependencyProblems(root).map(({ state, installed, expected }) => ({ state, installed, expected })), [
      { state: "stale", installed: version, expected: ["10.4.2"] },
    ]);
  }
});

test("unselected lockfile resolutions retain the sorted-version fallback", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { "lru-cache": "10" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: {
    "lru-cache@10.4.3": ["lru-cache@10.4.3"],
    "lru-cache@10.4.2": ["lru-cache@10.4.2"],
  } }));
  for (const version of ["10.4.2", "10.4.3"]) {
    setAppVersion(root, "lru-cache", version);
    assert.deepEqual(dependencyProblems(root), []);
  }
  setAppVersion(root, "lru-cache", "9.0.0");
  assert.deepEqual(dependencyProblems(root).map(({ state, installed, expected }) => ({ state, installed, expected })), [
    { state: "stale", installed: "9.0.0", expected: ["10.4.2", "10.4.3"] },
  ]);
});

test("the workspace-selected resolution applies even when its installed copy is hoisted", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { "lru-cache": "10" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: {
    "lru-cache": ["lru-cache@11.5.2"],
    "apps/web/lru-cache": ["lru-cache@10.4.3"],
  } }));
  setAppVersion(root, "lru-cache", "10.4.3");
  assert.deepEqual(dependencyProblems(root), []);
  setAppVersion(root, "lru-cache", "11.5.2");
  assert.deepEqual(dependencyProblems(root).map(({ state, installed, expected }) => ({ state, installed, expected })), [
    { state: "stale", installed: "11.5.2", expected: ["10.4.3"] },
  ]);
  rmSync(join(root, "apps/web/node_modules/lru-cache"), { recursive: true });
  const rootCopy = join(root, "node_modules/lru-cache");
  mkdirSync(rootCopy);
  for (const [version, expected] of [["10.4.3", undefined], ["11.5.2", ["10.4.3"]], ["9.0.0", ["10.4.3"]]]) {
    writeFileSync(join(rootCopy, "package.json"), JSON.stringify({ version }));
    assert.deepEqual(dependencyProblems(root), expected === undefined ? [] : [{
      absolute: join(root, "apps/web/node_modules/lru-cache"),
      relative: "apps/web/node_modules/lru-cache",
      state: "stale",
      installed: version,
      expected,
    }]);
  }
});

test("a nested zod copy from another lockfile parent is stale for apps/web", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { zod: "4.6.5" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: {
    zod: ["zod@4.6.5"],
    "@coinbase/cdp-sdk/zod": ["zod@3.25.76"],
    "shadcn/zod": ["zod@3.25.76"],
  } }));
  setAppVersion(root, "zod", "3.25.76");
  assert.deepEqual(dependencyProblems(root), [{
    absolute: join(root, "apps/web/node_modules/zod"),
    relative: "apps/web/node_modules/zod",
    state: "stale",
    installed: "3.25.76",
    expected: ["4.6.5"],
  }]);
  setAppVersion(root, "zod", "4.6.5");
  assert.deepEqual(dependencyProblems(root), []);
});

test("missing and unreadable lockfiles cannot verify dependency versions", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  setAppVersion(root, "next", "15.0.0");
  const absolute = join(root, "bun.lock");
  rmSync(absolute);
  assert.deepEqual(dependencyProblems(root), [{ absolute, relative: "bun.lock", state: "lockfile-missing" }]);
  assert.equal(describeProblem(dependencyProblems(root)[0]), "missing (dependency versions cannot be verified)");
  for (const content of ["", "not JSON", "{}", '{"packages": []}']) {
    writeFileSync(absolute, content);
    assert.deepEqual(dependencyProblems(root), [{ absolute, relative: "bun.lock", state: "lockfile-unreadable" }], `lockfile: ${content}`);
    assert.equal(describeProblem(dependencyProblems(root)[0]), "unreadable (dependency versions cannot be verified)");
  }
});

test("a lockfile that resolves none of the declared dependencies cannot verify versions", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  setAppVersion(root, "next", "15.0.0");
  const absolute = join(root, "bun.lock");
  const mismatch = { absolute, relative: "bun.lock", state: "lockfile-mismatched" };
  for (const packages of [{ lodash: ["lodash@4.17.21"] }, {}]) {
    writeFileSync(absolute, JSON.stringify({ packages }));
    const problems = dependencyProblems(root);
    assert.deepEqual(problems, [mismatch]);
    assert.equal(describeProblem(problems[0]), "out of sync with this worktree's dependencies (dependency versions cannot be verified)");
  }
  writeFileSync(absolute, JSON.stringify({ packages: { next: ["next@16.1.0"] } }));
  assert.deepEqual(dependencyProblems(root).map((problem) => problem.state), ["stale"]);
  setAppVersion(root, "next", "16.1.0");
  assert.deepEqual(dependencyProblems(root), []);
});

test("an installed package with no version is unknown, not stale", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: { next: ["next@16.1.0"] } }));
  assert.deepEqual(dependencyProblems(root), []);
  writeFileSync(join(root, "apps/web/node_modules/next/package.json"), "{}");
  assert.deepEqual(dependencyProblems(root), []);
});
test("installDependencies unlinks stale trees then installs and verifies a real tree", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "apps/web"), { recursive: true });
  const other = join(root, "other");
  mkdirSync(other);
  symlinkSync(other, join(root, "node_modules"));
  const calls = [];
  const run = (command, args, cwd) => {
    calls.push([command, args, cwd]);
    installedApp(root);
    return { status: 0 };
  };

  const result = installDependencies(root, run);
  assert.deepEqual(calls, [["bun", ["install", "--frozen-lockfile"], root]]);
  assert.equal(result.state, "installed");
  assert.deepEqual(dependencyProblems(root), []);
});

test("installDependencies is a no-op when both trees are real", (t) => {
  const root = scratch(t);
  installedApp(root);
  const run = () => {
    throw new Error("install must not run");
  };
  assert.deepEqual(installDependencies(root, run), { state: "present", problems: [] });
});

test("a forced install verifies a complete tree and repairs a stale tree", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: { next: ["next@16.1.0"] } }));
  setAppVersion(root, "next", "16.1.0");
  const calls = [];
  const run = (command, args, cwd) => {
    calls.push([command, args, cwd]);
    setAppVersion(root, "next", "16.1.0");
    return { status: 0 };
  };
  assert.deepEqual(installDependencies(root, run, undefined, { force: true }), { state: "verified", problems: [] });
  setAppVersion(root, "next", "15.0.0");
  assert.deepEqual(installDependencies(root, run, undefined, { force: true }), {
    state: "installed",
    problems: [{
      absolute: join(root, "apps/web/node_modules/next"),
      relative: "apps/web/node_modules/next",
      state: "stale",
      installed: "15.0.0",
      expected: ["16.1.0"],
    }],
  });
  assert.deepEqual(calls, [
    ["bun", ["install", "--frozen-lockfile"], root],
    ["bun", ["install", "--frozen-lockfile"], root],
  ]);
  assert.deepEqual(dependencyProblems(root), []);
});

test("installDependencies surfaces a failed install", (t) => {
  const root = scratch(t);
  const run = () => ({ status: 2 });
  assert.throws(() => installDependencies(root, run), /exit code 2/);
});

test("installDependencies refuses a tree that is still not ready after install", (t) => {
  const root = scratch(t);
  const run = () => ({ status: 0 });
  assert.throws(() => installDependencies(root, run), /still not ready/);
  assert.throws(() => installDependencies(root, run), /reinstall from scratch/);
});

for (const [name, behind, ahead, state, summary] of [
  ["behind", "3", "0", "behind", "3 commit(s) behind origin/main"],
  ["ahead", "0", "1", "ahead", "ahead of origin/main by 1 commit(s)"],
  ["diverged", "2", "4", "diverged", "diverged from origin/main (2 behind, 4 ahead)"],
  ["current", "0", "0", "current", "up to date with origin/main"],
]) {
  test(`baseStatus reports ${name}`, () => {
    const git = scriptedGit({
      "rev-parse --verify --quiet HEAD": "abc",
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
      "rev-parse --verify --quiet origin/main": "def",
      "rev-list --count HEAD..origin/main": behind,
      "rev-list --count origin/main..HEAD": ahead,
    });
    const status = baseStatus("/worktree", git);
    assert.equal(status.state, state);
    assert.match(baseSummary(status), new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("baseStatus is unknown outside a git repository or without a remote default branch", () => {
  assert.deepEqual(baseStatus("/worktree", scriptedGit({})), {
    state: "unknown",
    reason: "not a git repository",
  });
  const git = scriptedGit({ "rev-parse --verify --quiet HEAD": "abc" });
  assert.deepEqual(baseStatus("/worktree", git), {
    state: "unknown",
    reason: "no remote default branch",
  });
});

test("baseStatus is unknown when a commit count fails or is malformed", () => {
  const responses = {
    "rev-parse --verify --quiet HEAD": "abc",
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
    "rev-parse --verify --quiet origin/main": "def",
    "rev-list --count HEAD..origin/main": "2",
  };
  assert.deepEqual(baseStatus("/worktree", scriptedGit(responses)), {
    state: "unknown",
    reason: "cannot count commits against origin/main",
  });
  assert.deepEqual(baseStatus("/worktree", scriptedGit({ ...responses, "rev-list --count HEAD..origin/main": "many" })), {
    state: "unknown",
    reason: "cannot count commits against origin/main",
  });
});

test("copyWorktreeEnv never copies unless asked and never reads or overwrites", (t) => {
  const root = scratch(t);
  const primary = scratch(t);
  mkdirSync(join(primary, "apps/web"), { recursive: true });
  writeFileSync(join(primary, "apps/web/.env.local"), "SECRET=value\n");
  const git = scriptedGit({ "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n` });

  const skipped = copyWorktreeEnv(root, git);
  assert.equal(skipped.status, "skipped");
  assert.match(skipped.reason, /opt-in/);

  const copied = copyWorktreeEnv(root, git, { copy: true });
  assert.equal(copied.status, "copied");
  const target = join(root, "apps/web/.env.local");
  assert.equal(readFileSync(target, "utf8"), "SECRET=value\n");
  assert.equal(statSync(target).mode & 0o777, 0o600);

  writeFileSync(target, "LOCAL=only\n");
  assert.deepEqual(copyWorktreeEnv(root, git, { copy: true }), { status: "present", target });
  assert.equal(readFileSync(target, "utf8"), "LOCAL=only\n");
});
test("copyWorktreeEnv refuses to write through a dangling target symlink", (t) => {
  const root = scratch(t);
  const primary = scratch(t);
  mkdirSync(join(primary, "apps/web"), { recursive: true });
  writeFileSync(join(primary, "apps/web/.env.local"), "SECRET=value\n");
  mkdirSync(join(root, "apps/web"), { recursive: true });
  const target = join(root, "apps/web/.env.local");
  const dangling = join(root, "missing-env.local");
  symlinkSync(dangling, target);
  const git = scriptedGit({ "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n` });
  const result = copyWorktreeEnv(root, git, { copy: true });
  assert.equal(result.status, "absent");
  assert.match(result.reason, /not a regular file/);
  assert.equal(readlinkSync(target), dangling);
});
test("copyWorktreeEnv refuses an unusable env target without touching it", (t) => {
  const root = scratch(t);
  const primary = scratch(t);
  mkdirSync(join(primary, "apps/web"), { recursive: true });
  writeFileSync(join(primary, "apps/web/.env.local"), "SECRET=value\n");
  const target = join(root, "apps/web/.env.local");
  mkdirSync(target, { recursive: true });
  const git = scriptedGit({ "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n` });
  const result = copyWorktreeEnv(root, git, { copy: true });
  assert.equal(result.status, "absent");
  assert.match(result.reason, /not a regular file/);
  assert.equal(statSync(target).isDirectory(), true);
});

test("copyWorktreeEnv stays absent when the primary checkout has no env file", (t) => {
  const root = scratch(t);
  const primary = scratch(t);
  const git = scriptedGit({ "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n` });
  const result = copyWorktreeEnv(root, git, { copy: true });
  assert.equal(result.status, "absent");
  assert.equal(result.reason, "no usable source file in the primary checkout");
});

test("preflight reports symlinked and missing dependency trees with the bootstrap hint", (t) => {
  const root = scratch(t);
  const lines = preflightProblemLines(root);
  assert.equal(lines[0], "Home dependencies are not ready in this worktree:");
  assert.ok(lines.some((line) => line.includes("node_modules is missing")));
  assert.ok(lines.some((line) => line.includes(BOOTSTRAP_HINT)));

  installedApp(root);
  assert.deepEqual(preflightProblemLines(root), []);
});

test("preflight reports a missing lockfile and accepts a lockfile-consistent tree", (t) => {
  const root = scratch(t);
  installedApp(root);
  assert.deepEqual(preflightProblemLines(root), []);
  rmSync(join(root, "bun.lock"));
  assert.deepEqual(preflightProblemLines(root), [
    "Home dependencies are not ready in this worktree:",
    "  - bun.lock is missing (dependency versions cannot be verified)",
    `Run \`${BOOTSTRAP_HINT}\`, then rerun this command.`,
  ]);
});

test("preflight reports stale dependencies with the bootstrap hint", (t) => {
  const root = scratch(t);
  installedApp(root);
  writeFileSync(join(root, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "16.1.0" } }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: { next: ["next@16.1.0"] } }));
  setAppVersion(root, "next", "15.0.0");
  assert.deepEqual(preflightProblemLines(root), [
    "Home dependencies are not ready in this worktree:",
    "  - apps/web/node_modules/next is stale (installed 15.0.0; the lockfile resolves 16.1.0)",
    `Run \`${BOOTSTRAP_HINT}\`, then rerun this command.`,
  ]);
});

test("bootstrap installs, reports base and env, and ends with a readiness summary", (t) => {
  const root = scratch(t);
  installedApp(root);
  const primary = scratch(t);
  mkdirSync(join(primary, "apps/web"), { recursive: true });
  writeFileSync(join(primary, "apps/web/.env.local"), "SECRET=value\n");
  const git = scriptedGit({
    "rev-parse --verify --quiet HEAD": "abc",
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
    "rev-parse --verify --quiet origin/main": "def",
    "rev-list --count HEAD..origin/main": "2",
    "rev-list --count origin/main..HEAD": "0",
    "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n`,
  });
  const lines = [];
  const result = bootstrap(root, {
    git,
    run: () => ({ status: 0 }),
    copyEnv: true,
    log: (line) => lines.push(line),
  });

  assert.equal(result.dependencies.state, "verified");
  assert.equal(result.base.state, "behind");
  assert.equal(result.env.status, "copied");
  assert.match(result.summary, /^worktree ready: dependencies verified; base 2 commit\(s\) behind origin\/main/);
  assert.ok(lines.some((line) => line.includes("never rebases")));
  assert.equal(readFileSync(join(root, "apps/web/.env.local"), "utf8"), "SECRET=value\n");
});

test("bootstrap verifies an already complete tree and ends with one readiness summary", (t) => {
  const root = scratch(t);
  installedApp(root);
  assert.deepEqual(dependencyProblems(root), []);
  const lines = [];
  const calls = [];
  const result = bootstrap(root, {
    run: (command, args, cwd) => {
      calls.push([command, args, cwd]);
      return { status: 0 };
    },
    git: scriptedGit({}),
    log: (line) => lines.push(line),
  });
  assert.deepEqual(calls, [["bun", ["install", "--frozen-lockfile"], root]]);
  assert.equal(result.dependencies.state, "verified");
  assert.ok(lines.includes("worktree: dependencies already match bun.lock"));
  assert.match(result.summary, /^worktree ready: dependencies verified;/);
  assert.equal(lines.at(-1), result.summary);
  assert.equal(lines.filter((line) => line.startsWith("worktree ready:")).length, 1);
});

test("bootstrap leaves env files alone unless --copy-env is passed", (t) => {
  const root = scratch(t);
  installedApp(root);
  const primary = scratch(t);
  mkdirSync(join(primary, "apps/web"), { recursive: true });
  writeFileSync(join(primary, "apps/web/.env.local"), "SECRET=value\n");
  const git = scriptedGit({
    "rev-parse --verify --quiet HEAD": "abc",
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main",
    "rev-parse --verify --quiet origin/main": "def",
    "rev-list --count HEAD..origin/main": "0",
    "rev-list --count origin/main..HEAD": "0",
    "worktree list --porcelain": `worktree ${primary}\nHEAD abc\nbranch refs/heads/main\n`,
  });
  const result = bootstrap(root, { git, run: () => ({ status: 0 }), log: () => {} });
  assert.equal(result.env.status, "skipped");
  assert.equal(statSafe(join(root, "apps/web/.env.local")), false);
});

function statSafe(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

test("the bootstrap script is exposed as a package command", async () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"));
  assert.equal(packageJson.scripts["worktree:bootstrap"], "node scripts/worktree/bootstrap.mjs");
  assert.match(packageJson.scripts.gates, /scripts\/gates\/preflight\.mjs && node --test/);
});
