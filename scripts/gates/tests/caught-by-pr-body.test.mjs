import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { caughtByPrBodyFindings, prBodyDetectors } from "../caught-by-pr-body.mjs";

const title = "fix(home): repair state";

for (const value of ["lint", "unit", "bot", "review", "browser", "production"]) {
  test(`accepts ${value} in a scoped fix PR body`, () => {
    assert.deepEqual(caughtByPrBodyFindings(title, `## Test plan\nFailure-cases: 0/0\nCaught-by: ${value}`), []);
  });
}

for (const [name, body] of [
  ["empty body", ""],
  ["missing line", "## Test plan\nFailure-cases: 0/0"],
  ["invalid detector", "Caught-by: manual"],
  ["two different detectors", "Caught-by: lint\nCaught-by: review"],
  ["identical duplicate plus a different detector", "Caught-by: lint\nCaught-by: lint\nCaught-by: bot"],
  ["unit plus a different detector", "Caught-by: unit\nCaught-by: review"],
  ["unit only in HTML comment", "<!-- Caught-by: unit -->"],
  ["unit only in fenced code", "```text\nCaught-by: unit\n```"],
  ["only in HTML comment", "<!--\nCaught-by: lint\n-->"],
  ["only in inline HTML comment", "<!-- Caught-by: lint -->"],
  ["only in fenced code", "```text\nCaught-by: lint\n```"],
  ["only in tilde fence", "   ~~~~md\nCaught-by: lint\n   ~~~~"],
  ["only in unclosed fence", "````\nCaught-by: lint\n```\nCaught-by: lint"],
]) {
  test(`rejects ${name}`, () => {
    assert.match(caughtByPrBodyFindings(title, body)[0], /exactly one Caught-by detector/);
  });
}

test("counts identical duplicate detectors once", () => {
  assert.deepEqual(caughtByPrBodyFindings(title, "Caught-by: lint\nCaught-by: lint"), []);
});

test("ignores comments and fences but accepts visible lines and normalized newlines", () => {
  const body = "<!-- Caught-by: review -->\r\n```\r\nCaught-by: bot\r\n```\r\nCaught-by: lint\r\n";
  assert.deepEqual(caughtByPrBodyFindings(title, body), []);
});

test("extracts only distinct visible PR body detectors", () => {
  assert.deepEqual(prBodyDetectors("<!-- Caught-by: bot -->\n```\nCaught-by: production\n```\nCaught-by: review\nCaught-by: review"), ["review"]);
  assert.deepEqual(prBodyDetectors("<!--\nCaught-by: bot\n-->\n~~~\nCaught-by: lint\n~~~"), []);
  assert.deepEqual(prBodyDetectors("Caught-by: review\nCaught-by: bot"), ["review", "bot"]);
});

test("does not require a detector for non-fix and unscoped fix titles", () => {
  for (const otherTitle of ["ops(gates): update CI", "fix: repair state", "docs(home): explain fix(home): state", "Fix(home): repair state"]) {
    assert.deepEqual(caughtByPrBodyFindings(otherTitle, "Caught-by: lint\nCaught-by: bot"), []);
  }
});

test("the template hint is ignored until a fix PR author adds a detector", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.match(caughtByPrBodyFindings(title, template)[0], /exactly one/);
  assert.deepEqual(caughtByPrBodyFindings(title, `${template}\nCaught-by: review`), []);
});

test("CLI accepts a fix and a non-fix body, rejects missing or conflicting detectors and extra arguments", () => {
  const run = (prTitle, body, args = []) => spawnSync(process.execPath, ["scripts/gates/caught-by-pr-body.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, PR_TITLE: prTitle, PR_BODY: body },
  });
  const pass = run(title, "Caught-by: lint");
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /Caught-by PR body gate passed/);
  assert.equal(run("ops(gates): update CI", "").status, 0);
  for (const body of ["", "Caught-by: lint\nCaught-by: production"]) {
    const fail = run(title, body);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /must name exactly one/);
  }
  const usage = run(title, "Caught-by: lint", ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
});
