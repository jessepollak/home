import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prClosingLinkFindings } from "../pr-closing-link.mjs";

const title = "ops(gates): update metadata";

for (const type of ["feat", "fix", "test", "ops", "dx", "docs", "chore"]) {
  for (const scope of ["", "(home)"]) {
    test(`${type}${scope} title requires a closing link or no-issue reason`, () => {
      const subject = `${type}${scope}: change`;
      assert.match(prClosingLinkFindings(subject, "")[0], /must have a visible/);
      assert.deepEqual(prClosingLinkFindings(subject, "Closes #123"), []);
      assert.deepEqual(prClosingLinkFindings(subject, "No issue: operator maintenance"), []);
    });
  }
}

for (const keyword of ["Closes", "Fixes", "Resolves"]) {
  test(`accepts ${keyword} with a positive issue number`, () => {
    assert.deepEqual(prClosingLinkFindings(title, `## Test plan\nFailure-cases: N/A: CI-only\n${keyword} #123`), []);
  });
}

test("accepts visible lines after comments and fences, including normalized newlines", () => {
  const body = "<!-- Closes #1 -->\r\n```md\r\nFixes #2\r\n```\r\nResolves #123\r\n";
  assert.deepEqual(prClosingLinkFindings(title, body), []);
});

for (const [name, body] of [
  ["empty body", ""],
  ["only a reference", "Refs #123"],
  ["no issue number", "Closes #"],
  ["zero issue number", "Fixes #0"],
  ["trailing prose on closing line", "Resolves #123 and others"],
  ["keyword in an HTML comment", "<!--\nCloses #123\n-->"],
  ["keyword in an inline HTML comment", "<!-- Fixes #123 -->"],
  ["keyword in fenced code", "```md\nResolves #123\n```"],
  ["keyword in an unclosed tilde fence", "~~~~md\nCloses #123"],
  ["empty no-issue reason", "No issue:"],
  ["whitespace-only no-issue reason", "No issue: \t "],
  ["no-issue in an HTML comment", "<!-- No issue: operator change -->"],
  ["no-issue in fenced code", "~~~\nNo issue: operator change\n~~~"],
]) {
  test(`rejects ${name}`, () => {
    assert.match(prClosingLinkFindings(title, body)[0], /visible Closes #<n>/);
  });
}

test("design and product titles pass with a reference or no body", () => {
  for (const subject of ["design(home): explore", "product(home): propose", "design: explore", "product: propose"]) {
    assert.deepEqual(prClosingLinkFindings(subject, "Refs #123"), []);
    assert.deepEqual(prClosingLinkFindings(subject, ""), []);
  }
});

test("unrelated title text does not count as an implementation prefix", () => {
  assert.deepEqual(prClosingLinkFindings("Research feat(home): plan", ""), []);
});

test("template hint does not satisfy the check without an issue number or reason", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.match(prClosingLinkFindings(title, template)[0], /visible/);
  assert.deepEqual(prClosingLinkFindings(title, template.replace("\nCloses #", "\nNo issue: operator change")), []);
});

test("CLI accepts a link or reason and rejects a missing one and extra arguments", () => {
  const run = (prTitle, body, args = []) => spawnSync(process.execPath, ["scripts/gates/pr-closing-link.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, PR_TITLE: prTitle, PR_BODY: body },
  });
  for (const body of ["Closes #123", "No issue: operator change"]) {
    const pass = run(title, body);
    assert.equal(pass.status, 0);
    assert.match(pass.stdout, /PR closing link gate passed/);
  }
  assert.equal(run("design(home): propose", "Refs #123").status, 0);
  const fail = run(title, "<!-- Closes #123 -->");
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /must have a visible/);
  const usage = run(title, "Closes #123", ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
});
