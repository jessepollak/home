import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectUnitTestDelta,
  isUnitTestPath,
  parseUnitTestFileChanges,
  parseUnitTestNumstat,
  renderUnitTestDelta,
  run,
} from "../unit-test-delta.mjs";
import { removeFixture } from "./fixture-cleanup.mjs";
import { applyGitFixtureEnv, gitFixtureEnv } from "./git-fixture-env.mjs";

applyGitFixtureEnv();

const cli = fileURLToPath(new URL("../unit-test-delta.mjs", import.meta.url));
const fixture = mkdtempSync(path.join(tmpdir(), "unit-test-delta-"));
const repo = path.join(fixture, "repo");
mkdirSync(repo);
after(() => removeFixture(fixture));

function git(args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", env: gitFixtureEnv() });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(file, contents) {
  const destination = path.join(repo, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function commit(subject) {
  git(["add", "."]);
  git(["commit", "-q", "-m", subject]);
}

const unusualPath = "apps/web/components/name\twith\nnewline.test.tsx";
git(["init", "-q", "-b", "main"]);
git(["config", "user.email", "gates-fixture@example.com"]);
git(["config", "user.name", "Gates Fixture"]);
write("apps/web/server/remove.test.ts", "// removed\n\nexport {};\n");
write("apps/web/server/empty-remove.test.ts", "");
write("apps/web/server/change.test.ts", "keep\nbefore\n");
write("apps/web/client/move.test.ts", "first\nsecond\n");
write("apps/web/tests/outside.test.ts", "outside\n");
write(unusualPath, "keep\n");
commit("chore(home): seed fixture");
const mergeBase = git(["rev-parse", "HEAD"]);
git(["branch", "feature"]);
write("apps/web/app/main-only.test.ts", "base-only\nchange\n");
commit("test(home): change base only");
git(["checkout", "-q", "feature"]);
for (const file of ["server/remove.test.ts", "server/empty-remove.test.ts", "client/move.test.ts"]) {
  rmSync(path.join(repo, "apps/web", file));
}
write("apps/web/server/change.test.ts", "keep\nafter\n");
write("apps/web/server/add.test.ts", "// added\n\nexport {};");
write("apps/web/client/empty-add.test.tsx", "");
write("apps/web/shared/moved.test.ts", "first\nsecond\n");
write(unusualPath, "keep\nadded\n");
write("apps/web/tests/outside.test.ts", "changed\nignored\n");
write("apps/web/config/ignored.test.ts", "ignored\n");
write("apps/web/root.test.ts", "ignored\n");
write("apps/web/components/ignored.spec.ts", "ignored\n");
commit("test(home): change unit corpus");

const expected = { addedLines: 7, deletedLines: 6, addedFiles: 3, deletedFiles: 3 };
const summary = "Unit-test lines: +7 / −6 (files +3 / −3)";

for (const layer of ["app", "client", "components", "server", "shared"]) {
  test(`matches root and nested .test.ts and .test.tsx files in ${layer}`, () => {
    assert.equal(isUnitTestPath(`apps/web/${layer}/amount.test.ts`), true);
    assert.equal(isUnitTestPath(`apps/web/${layer}/nested/amount.test.tsx`), true);
  });
}

test("excludes other layers, extensions, and test naming conventions", () => {
  for (const file of [
    "apps/web/tests/amount.test.ts", "apps/web/config/amount.test.ts", "apps/web/amount.test.ts",
    "apps/web/server/amount.test.mts", "apps/web/server/amount.spec.ts", "apps/web/server/amount.test.ts.backup",
    "apps/web/server/amount.ts", "other/apps/web/server/amount.test.ts",
  ]) assert.equal(isUnitTestPath(file), false, file);
});

test("parses NUL-delimited numstat, retaining tabs and newlines in paths", () => {
  assert.deepEqual(parseUnitTestNumstat(`2\t3\t${unusualPath}\0` +
    "0\t0\tapps/web/app/empty.test.ts\0" + "50\t40\tapps/web/tests/ignored.test.ts\0"),
  { addedLines: 2, deletedLines: 3 });
  assert.deepEqual(parseUnitTestNumstat(""), { addedLines: 0, deletedLines: 0 });
  assert.throws(() => parseUnitTestNumstat("broken\0"), /malformed numstat/);
  assert.throws(() => parseUnitTestNumstat("-\t-\tapps/web/server/binary.test.ts\0"), /binary files/);
});

test("parses file additions and deletions independently of line counts", () => {
  assert.deepEqual(parseUnitTestFileChanges(`A\0${unusualPath}\0D\0apps/web/server/empty.test.ts\0` +
    "A\0apps/web/tests/ignored.test.ts\0"), { addedFiles: 1, deletedFiles: 1 });
  assert.deepEqual(parseUnitTestFileChanges(""), { addedFiles: 0, deletedFiles: 0 });
  assert.throws(() => parseUnitTestFileChanges("A\0"), /malformed file-status/);
});

test("counts physical line changes, empty files, and moves against the merge-base, not the base tip", () => {
  assert.deepEqual(collectUnitTestDelta({ cwd: repo, base: "main" }), expected);
  assert.deepEqual(collectUnitTestDelta({ cwd: repo, base: mergeBase }), expected);
  assert.equal(renderUnitTestDelta(expected), summary);
});

test("the CLI prints one summary line and appends without replacing the step summary", () => {
  const stepSummary = path.join(fixture, "summary.md");
  writeFileSync(stepSummary, "existing\n");
  const result = spawnSync(process.execPath, [cli], {
    cwd: repo, encoding: "utf8", env: { ...gitFixtureEnv(), BASE_REF: "main", GITHUB_STEP_SUMMARY: stepSummary },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${summary}\n`);
  assert.equal(readFileSync(stepSummary, "utf8"), `existing\n${summary}\n`);
});

test("uses the PR remote base branch by default and returns zero", () => {
  git(["update-ref", "refs/remotes/origin/main", "main"]);
  let output = "";
  assert.equal(run({ cwd: repo, env: { GITHUB_BASE_REF: "main" }, stdout: { write: (value) => { output += value; } } }), 0);
  assert.equal(output, `${summary}\n`);
});

test("the CLI always exits zero for a missing base, unavailable corpus, or unwritable summary", () => {
  for (const [cwd, base, stepSummary] of [
    [repo, "missing-ref", path.join(fixture, "missing-base.md")],
    [fixture, "main", ""],
    [repo, "main", fixture],
  ]) {
    const result = spawnSync(process.execPath, [cli], {
      cwd, encoding: "utf8", env: { ...gitFixtureEnv(), BASE_REF: base, GITHUB_STEP_SUMMARY: stepSummary },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Unit-test delta: .*\(informational\)/);
    if (base === "missing-ref") assert.equal(readFileSync(stepSummary, "utf8"), result.stdout);
  }
});
