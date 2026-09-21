import assert from "node:assert/strict";
import test from "node:test";

import {
  caughtByViolations,
  detectCommitRange,
  readCommitsForRange,
} from "../caught-by.mjs";

const commit = (subject, body = "") => ({ sha: "a".repeat(40), subject, body });

test("requires exactly one allowed Caught-by trailer on scoped fix commits", () => {
  for (const value of ["lint", "bot", "review", "browser", "production"]) {
    assert.deepEqual(caughtByViolations([commit("fix(home): repair state", `details\n\nCaught-by: ${value}`)]), []);
  }
  assert.match(caughtByViolations([commit("fix(home): repair state")])[0], /must include exactly one Caught-by trailer$/);
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: guess")]).length, 1);
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: lint\nCaught-by: review")]).length, 1);
});

test("fetches and retries when the remote base ref is missing", () => {
  const calls = [];
  let verifyAttempts = 0;
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && verifyAttempts++ === 0) throw new Error("missing ref");
    if (args[0] === "merge-base") return "base-sha";
    return "";
  };

  assert.equal(detectCommitRange({ env: { GITHUB_BASE_REF: "main" }, gitRunner }), "base-sha..HEAD");
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "origin/main"],
    ["fetch", "--no-tags", "--depth=200", "origin", "main"],
    ["rev-parse", "--verify", "origin/main"],
    ["merge-base", "HEAD", "origin/main"],
  ]);
});

test("fails loudly when the remote base ref is still missing after fetch", () => {
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse") throw new Error("missing ref");
    return "";
  };

  assert.throws(
    () => detectCommitRange({ env: { GITHUB_BASE_REF: "main" }, gitRunner }),
    /could not resolve base ref origin\/main/,
  );
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "origin/main"],
    ["fetch", "--no-tags", "--depth=200", "origin", "main"],
    ["rev-parse", "--verify", "origin/main"],
  ]);
});

test("accepts an empty commit list", () => {
  assert.deepEqual(caughtByViolations([]), []);
});

test("does not apply the trailer contract to non-fix or unscoped subjects", () => {
  assert.deepEqual(caughtByViolations([
    commit("feat(home): add state"),
    commit("docs(ops): explain fixes"),
    commit("fix: legacy unscoped subject"),
  ]), []);
});

test("the active commit range satisfies the Caught-by contract", () => {
  const range = detectCommitRange();
  const violations = caughtByViolations(readCommitsForRange(range));
  assert.deepEqual(violations, [], violations.join("\n"));
});
