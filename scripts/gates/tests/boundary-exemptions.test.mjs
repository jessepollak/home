import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkBoundaryExemptions } from "../boundary-exemptions.mjs";
import { EXEMPTIONS_PATH, evaluateBoundaryExemptions, readBoundaryBase } from "../exploration-boundary.mjs";
import { gitFixtureEnv } from "./git-fixture-env.mjs";

const entry = { path: "probe", reason: "Probe helpers are non-production." };
const clean = { stale: [], dormant: [], reactivated: [], invalid: [] };
const evaluate = (directories, exemptions, base) => {
  const { stale, dormant, reactivated, invalid } = evaluateBoundaryExemptions({ directories, exemptions, base });
  return { stale, dormant, reactivated, invalid };
};

test("the live exemptions pass against the base revision", (t) => {
  const { notes, failures } = checkBoundaryExemptions(process.env.BASE_REF || "main");
  for (const note of notes) t.diagnostic(note);
  assert.deepEqual(failures, []);
});

test("a directory entry the base carried may cover nothing without failing", () => {
  const base = { directories: ["probe"], exemptions: [entry] };
  assert.deepEqual(evaluate([], [entry], base), { ...clean, dormant: ["probe"] });
  assert.deepEqual(evaluate([], [entry], { directories: [], exemptions: [entry] }), { ...clean, dormant: ["probe"] });
});

test("an entry that is new or reworded at the base revision is stale while it covers nothing", () => {
  assert.deepEqual(evaluate([], [entry], { directories: ["probe"], exemptions: [] }), { ...clean, stale: ["probe"] });
  assert.deepEqual(evaluate([], [entry], { directories: ["probe"], exemptions: [{ ...entry, reason: "Older reason." }] }), { ...clean, stale: ["probe"] });
  assert.deepEqual(evaluate([], [entry]), { ...clean, stale: ["probe"] });
});

test("an entry that covered nothing at the base revision fails when source returns unless its reason is reviewed again", () => {
  const base = { directories: [], exemptions: [entry] };
  assert.deepEqual(evaluate(["probe"], [entry], base), { ...clean, reactivated: ["probe"] });
  assert.deepEqual(evaluate(["probe"], [{ ...entry, reason: "Renewed after review." }], base), clean);
  assert.deepEqual(evaluate(["probe"], [entry], { directories: [], exemptions: [] }), clean);
  assert.deepEqual(evaluate(["probe"], [entry], { directories: ["probe"], exemptions: [entry] }), clean);
});

test("root-file entries stay stale when their file is gone", () => {
  const root = { path: "verify.ts", reason: "Verification CLI, not application code." };
  const result = evaluateBoundaryExemptions({ directories: [], rootFiles: [], exemptions: [root], base: { directories: [], exemptions: [root] } });
  assert.deepEqual(result.stale, ["verify.ts"]);
  assert.deepEqual(result.dormant, []);
});

test("base resolution reads the remote branch tip or a commit SHA and fails loudly", () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === "ls-tree" && !args.includes("-r")) return EXEMPTIONS_PATH;
    if (args[0] === "ls-tree") return "apps/web/probe/a.ts\0apps/web/README.md\0apps/web/app/page.tsx\0";
    return JSON.stringify([entry]);
  };
  assert.deepEqual(readBoundaryBase("main", runner), { base: "origin/main", directories: ["app", "probe"], exemptions: [entry] });
  assert.equal(readBoundaryBase("a".repeat(40), runner).base, "a".repeat(40));
  assert.ok(calls.every((args) => args.includes("origin/main") || args.includes("a".repeat(40)) || args.some((arg) => arg.startsWith("origin/main:") || arg.startsWith(`${"a".repeat(40)}:`))));
  assert.throws(() => readBoundaryBase("main", () => { throw new Error("remote unavailable"); }), /Could not read the exploration boundary baseline at origin\/main: remote unavailable/);
  assert.throws(() => readBoundaryBase("--upload-pack=x", runner), /Invalid base ref/);
  const absent = (args) => (args[0] === "ls-tree" && !args.includes("-r") ? "" : runner(args));
  assert.deepEqual(readBoundaryBase("main", absent).exemptions, []);
});

function createMirror(t) {
  const directory = mkdtempSync(`${tmpdir()}/home-boundary-exemptions-`);
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(`${directory}/scripts/gates`, { recursive: true });
  mkdirSync(`${directory}/apps/web/probe`, { recursive: true });
  mkdirSync(`${directory}/apps/web/other`, { recursive: true });
  for (const file of ["boundary-exemptions.mjs", "exploration-boundary.mjs"]) copyFileSync(`${root}/scripts/gates/${file}`, `${directory}/scripts/gates/${file}`);
  const git = (args) => execFileSync("git", args, { cwd: directory, env: gitFixtureEnv(), encoding: "utf8" }).trim();
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  const cli = (base) => spawnSync(process.execPath, ["scripts/gates/boundary-exemptions.mjs"], {
    cwd: directory, env: { ...gitFixtureEnv(), BASE_REF: base }, encoding: "utf8",
  });
  const write = (file, content) => {
    mkdirSync(`${directory}/${file}`.replace(/\/[^/]*$/u, ""), { recursive: true });
    writeFileSync(`${directory}/${file}`, content);
  };
  const remove = (file) => rmSync(`${directory}/${file}`);
  const writeEntries = (entries) => write(EXEMPTIONS_PATH, `${JSON.stringify(entries, null, 2)}\n`);
  const commit = (message) => {
    git(["add", "-A"]);
    git(["commit", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  };
  return { cli, commit, git, remove, write, writeEntries };
}

test("concurrent removals under one directory entry merge green in either order while a reactivation still fails", (t) => {
  for (const order of [["pr-a", "pr-b"], ["pr-b", "pr-a"]]) {
    const { cli, commit, git, remove, write, writeEntries } = createMirror(t);
    write("apps/web/probe/a.ts", "export const a = 1;\n");
    write("apps/web/probe/b.ts", "export const b = 1;\n");
    write("apps/web/other/c.ts", "export const c = 1;\n");
    writeEntries([entry, { path: "other", reason: "Other helpers are non-production." }]);
    const m0 = commit("initial fixture");
    for (const [branch, file] of [["pr-a", "a.ts"], ["pr-b", "b.ts"]]) {
      git(["checkout", "-b", branch, m0]);
      remove(`apps/web/probe/${file}`);
      commit(`remove ${file}`);
      const result = cli(m0);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
    git(["checkout", "main"]);
    git(["merge", "--no-edit", order[0]]);
    const middle = git(["rev-parse", "HEAD"]);
    git(["merge", "--no-edit", order[1]]);
    for (const base of [m0, middle]) {
      const merged = cli(base);
      assert.equal(merged.status, 0, merged.stderr);
      assert.equal(merged.stderr, "");
    }
    assert.match(cli(m0).stdout, /^probe: exemption covers no source file; remove the entry/u);
    const tip = git(["rev-parse", "HEAD"]);

    git(["checkout", "-b", "pr-reactivate"]);
    write("apps/web/probe/d.ts", "export const d = 1;\n");
    commit("add source under the emptied directory");
    const reactivated = cli(tip);
    assert.equal(reactivated.status, 1, reactivated.stdout);
    assert.match(reactivated.stderr, /^probe: exemption covered no source at the base revision and now covers one again/u);

    writeEntries([{ ...entry, reason: "Probe helpers are non-production after review." }, { path: "other", reason: "Other helpers are non-production." }]);
    commit("renew the entry");
    assert.equal(cli(tip).status, 0);

    git(["checkout", "main"]);
    git(["checkout", "-b", "pr-ghost"]);
    writeEntries([entry, { path: "other", reason: "Other helpers are non-production." }, { path: "ghost", reason: "Never had source." }]);
    commit("add an entry for a directory without source");
    const ghost = cli(tip);
    assert.equal(ghost.status, 1);
    assert.match(ghost.stderr, /^ghost: stale exploration boundary exemption/u);
  }
});

test("removing the last file of a directory in one change is a note until its entry is removed", (t) => {
  const { cli, commit, git, remove, write, writeEntries } = createMirror(t);
  write("apps/web/probe/a.ts", "export const a = 1;\n");
  writeEntries([entry]);
  const m0 = commit("initial fixture");
  git(["checkout", "-b", "pr"]);
  remove("apps/web/probe/a.ts");
  commit("remove source");
  const result = cli(m0);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^probe: exemption covers no source file/u);
  writeEntries([]);
  commit("remove entry");
  const dropped = cli(m0);
  assert.equal(dropped.status, 0, dropped.stderr);
  assert.equal(dropped.stdout, "");
});

test("an unresolvable base fails loudly", (t) => {
  const { cli, commit, write, writeEntries } = createMirror(t);
  write("apps/web/probe/a.ts", "export const a = 1;\n");
  writeEntries([entry]);
  commit("initial fixture");
  const result = cli("not-a-real-base-ref");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read the exploration boundary baseline at origin\/not-a-real-base-ref/u);
});
