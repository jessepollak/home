import assert from "node:assert/strict";
import test from "node:test";

import {
  caughtByViolations,
  detectCommitRange,
  readCommitsForRange,
} from "../caught-by.mjs";

const commit = (subject, body = "") => ({ sha: "a".repeat(40), subject, body });

test("requires an allowed Caught-by trailer on scoped fix commits", () => {
  for (const value of ["lint", "bot", "review", "browser", "production"]) {
    assert.deepEqual(caughtByViolations([commit("fix(home): repair state", `details\n\nCaught-by: ${value}`)]), []);
  }
  assert.equal(caughtByViolations([commit("fix(home): repair state")]).length, 1);
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: guess")]).length, 1);
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
