import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  caughtByDetectors,
  caughtByViolations,
  squashedCommits,
  detectCommitRange,
  readCommitsForRange,
} from "../caught-by.mjs";

const commit = (subject, body = "") => ({ sha: "a".repeat(40), subject, body });

// The squash-merge message GitHub wrote for #742 (ab5f7eee on main): every inner
// commit's body is concatenated, so the one detector appears once per commit.
const squashedMainHead = {
  sha: "ab5f7eee8478" + "0".repeat(28),
  subject: "fix(lint): treat a throwing finally block as a catch disposition (#742)",
  body: [
    "* fix(lint): treat a throwing finally block as a catch disposition",
    "",
    "A `try`/`finally` whose finalizer always throws cannot fall through.",
    "",
    "Caught-by: lint",
    "Co-authored-by: Toshi <toshi-noreply@coinbase.com>",
    "",
    "* docs(gates): count a throwing finally block as a disposition",
    "",
    "Caught-by: lint",
    "Co-authored-by: Toshi <toshi-noreply@coinbase.com>",
    "",
    "---------",
    "",
    "Co-authored-by: Toshi <toshi-noreply@coinbase.com>",
  ].join("\n"),
};

test("requires exactly one allowed Caught-by detector on scoped fix commits", () => {
  for (const value of ["lint", "bot", "review", "browser", "production"]) {
    assert.deepEqual(caughtByViolations([commit("fix(home): repair state", `details\n\nCaught-by: ${value}`)]), []);
  }
  assert.match(caughtByViolations([commit("fix(home): repair state")])[0], /must name exactly one Caught-by detector$/);
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: guess")]).length, 1);
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: lint\nCaught-by: review")]).length, 1);
});

test("counts duplicate identical trailers from a squash body once", () => {
  assert.deepEqual(caughtByDetectors(squashedMainHead.body), ["lint"]);
  assert.deepEqual(caughtByViolations([squashedMainHead]), []);
  assert.deepEqual(caughtByViolations([commit("fix(home): repair state", "Caught-by: review\n\n* inner\n\nCaught-by: review\n\nCaught-by: review")]), []);
  // Two distinct detectors are still ambiguous, and repeating one of them does not settle it.
  assert.equal(caughtByViolations([commit("fix(home): repair state", "Caught-by: lint\nCaught-by: lint\nCaught-by: review")]).length, 1);
  assert.deepEqual(caughtByDetectors("Caught-by: lint\nCaught-by: bot\nCaught-by: lint"), ["lint", "bot"]);
  assert.deepEqual(caughtByDetectors("no trailer here\nCaught-by: guess"), []);
});

test("holds each squashed fix to one detector instead of the whole merge", () => {
  const twoFixes = [
    "* fix(funding): address the Peer indexer by its GraphQL endpoint",
    "",
    "Caught-by: production",
    "Closes #767",
    "",
    "* fix(funding): register the offramp orders provider-error code with observability",
    "",
    "Caught-by: review",
  ].join("\n");
  assert.deepEqual(caughtByViolations([commit("fix(funding): address the Peer indexer (#768)", twoFixes)]), []);
  assert.deepEqual(squashedCommits(twoFixes).map((section) => section.subject), [
    "fix(funding): address the Peer indexer by its GraphQL endpoint",
    "fix(funding): register the offramp orders provider-error code with observability",
  ]);
  assert.equal(squashedCommits("Caught-by: lint\n\n* a plain bullet"), null);
  const missingInner = twoFixes.replace("Caught-by: review", "");
  assert.match(caughtByViolations([commit("fix(funding): squash (#1)", missingInner)])[0], /squashed commit "fix\(funding\): register the offramp orders provider-error code with observability" must name exactly one/);
  const doubledInner = twoFixes.replace("Caught-by: review", "Caught-by: review\nCaught-by: bot");
  assert.equal(caughtByViolations([commit("fix(funding): squash (#1)", doubledInner)]).length, 1);
  const docsOnlyTrailer = "* fix(home): repair state\n\nCaught-by: lint\n\n* docs(home): explain\n";
  assert.deepEqual(caughtByViolations([commit("fix(home): repair state (#2)", docsOnlyTrailer)]), []);
});

test("the squash-merged main head 79b790da passes as HEAD^!", (t) => {
  const probe = spawnSync("git", ["cat-file", "-e", "79b790dadbe4^{commit}"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("79b790da is not in this checkout");
  assert.deepEqual(caughtByViolations(readCommitsForRange("79b790dadbe4^!")), []);
});

test("the squash-merged main head ab5f7eee passes as HEAD^!", (t) => {
  // Regression for main going red on 2026-09-22: the real commit must pass the
  // gate on its own so the next push to main is green. Skipped when a shallow
  // checkout does not contain the commit; the fixture above covers its shape.
  const probe = spawnSync("git", ["cat-file", "-e", "ab5f7eee8478^{commit}"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("ab5f7eee is not in this checkout");
  assert.deepEqual(caughtByViolations(readCommitsForRange("ab5f7eee8478^!")), []);
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
