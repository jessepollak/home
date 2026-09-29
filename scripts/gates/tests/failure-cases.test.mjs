import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { failureCasesFindings, failureCasesReport } from "../failure-cases.mjs";

for (const [name, body, expected] of [
  ["empty body", "", /## Test plan/],
  ["no Test plan", "## Review\nFailure-cases: 2/3", /## Test plan/],
  ["missing line", "## Test plan\n- [ ] Tests passed", /missing/],
  ["line outside Test plan", "## Test plan\n## Real money\nFailure-cases: 2/3", /inside ## Test plan/],
  ["indented heading ends Test plan", "## Test plan\n  ## Real money\nFailure-cases: 2/3", /inside ## Test plan/],
  ["line only inside an HTML comment", "## Test plan\n<!--\nFailure-cases: 2/3\n-->", /missing/],
  ["line only inside an inline HTML comment", "## Test plan\n<!-- Failure-cases: 2/3 -->", /missing/],
  ["line after an unclosed HTML comment", "## Test plan\n<!--\nFailure-cases: 1/1", /missing/],
  ["line after a paired and then unclosed HTML comment", "## Test plan\n<!-- paired -->\n<!--\nFailure-cases: 1/1", /missing/],
  ["fenced Test plan is not a section", "```md\n## Test plan\nFailure-cases: 1/1\n```", /## Test plan/],
  ["unclosed fenced Test plan is not a section", "~~~md\n## Test plan\nFailure-cases: 1/1", /## Test plan/],
  ["fenced line in a real section", "## Test plan\n```\nFailure-cases: 1/1\n```", /missing/],
  ["indented tilde fence with info string hides line", "## Test plan\n   ~~~~text\nFailure-cases: 1/1\n   ~~~~~", /missing/],
  ["unclosed fence hides line", "## Test plan\n```\nFailure-cases: 1/1", /missing/],
  ["shorter fence does not close longer fence", "## Test plan\n````\n```\nFailure-cases: 1/1", /missing/],
  ["different fence character does not close fence", "## Test plan\n~~~\n```\nFailure-cases: 1/1", /missing/],
  ["duplicate lines across Test plan sections", "## Test plan\nFailure-cases: 1/1\n## Review\n## Test plan\nFailure-cases: 0/0", /exactly one/],
  ["duplicate lines", "## Test plan\nFailure-cases: 2/3\nFailure-cases: 3/3", /exactly one/],
  ["missing tested", "## Test plan\nFailure-cases: 2/", /Malformed/],
  ["non-numeric", "## Test plan\nFailure-cases: a/b", /Malformed/],
  ["tested greater than calls", "## Test plan\nFailure-cases: 3/2", /tested count cannot exceed dependency calls/],
  ["leading zero", "## Test plan\nFailure-cases: 02/3", /Malformed/],
  ["bare N/A", "## Test plan\nFailure-cases: N/A", /Malformed/],
  ["N/A without reason", "## Test plan\nFailure-cases: N/A:", /Malformed/],
  ["lowercase n/a", "## Test plan\nFailure-cases: n/a: x", /Malformed/],
  ["spaces in fraction", "## Test plan\nFailure-cases: 2 / 3", /Malformed/],
  ["text glued to the fraction", "## Test plan\nFailure-cases: 2/3extra", /Malformed/],
  ["prose instead of counts", "## Test plan\nFailure-cases: malformed inputs are covered", /Malformed/],
  ["note does not excuse an inverted fraction", "## Test plan\nFailure-cases: 4/3 (three reads)", /cannot exceed/],
  ["level-one heading ends the section", "## Test plan\n# Next\nFailure-cases: 2/3", /inside ## Test plan/],
  ["tab-separated level-one heading ends the section", "## Test plan\n#\tNext\nFailure-cases: 2/3", /inside ## Test plan/],
  ["tab-separated level-two heading ends the section", "## Test plan\n##\tReal money\nFailure-cases: 2/3", /inside ## Test plan/],
  ["details close ends the section", "## Test plan\n</details>\nFailure-cases: 2/3", /inside ## Test plan/],
  ["indented details close ends the section", "## Test plan\n  </details>\nFailure-cases: 2/3", /inside ## Test plan/],
]) {
  test(name, () => assert.match(failureCasesFindings(body)[0], expected));
}

for (const [name, body, value] of [
  ["partial coverage", "## Test plan\nFailure-cases: 2/3", "2/3"],
  ["no dependency calls", "## Test plan\nFailure-cases: 0/0", "0/0"],
  ["full coverage", "## Test plan\nFailure-cases: 3/3", "3/3"],
  ["counts with a trailing note", "## Test plan\nFailure-cases: 3/3 (RPC POST, GraphQL POST, rate GET)", "3/3 (RPC POST, GraphQL POST, rate GET)"],
  ["zero counts with a dash note", "## Test plan\nFailure-cases: 0/0 — fixture intercepts only", "0/0 — fixture intercepts only"],
  ["docs-only exemption", "## Test plan\nFailure-cases: N/A: docs-only", "N/A: docs-only"],
  ["fence with unmatched comment opener does not hide following line", "## Test plan\n```\n<!--\n```\nFailure-cases: 1/1", "1/1"],
  ["inline code comment opener does not hide following line", "## Test plan\n`<!--`\nFailure-cases: 1/1", "1/1"],
  ["indented Test plan starts a section", "  ## Test plan\nFailure-cases: 1/1", "1/1"],
  ["multiline comment hides lines until a closing line", "## Test plan\nstart <!--\nFailure-cases: 9/9\n-->\nFailure-cases: 1/1", "1/1"],
  ["multiline comment allows a valid line after its close", "## Test plan\n<!--\nFailure-cases: 9/9\n-->Failure-cases: 1/1", "1/1"],
  ["CRLF body", "## Test plan\r\nFailure-cases: 2/3\r\n## Real money", "2/3"],
  ["CR body", "## Test plan\rFailure-cases: 2/3\r## Real money", "2/3"],
  ["subheading remains inside Test plan", "## Test plan\n### Subheading\nFailure-cases: 2/3\n## Real money", "2/3"],
  ["tab-separated subheading remains inside Test plan", "## Test plan\n###\tSubheading\nFailure-cases: 2/3", "2/3"],
  ["fenced heading does not end Test plan", "## Test plan\n```md\n## Real money\n```\nFailure-cases: 1/1", "1/1"],
  ["line in a later Test plan section counts", "## Test plan\n## Review\n## Test plan\nFailure-cases: 1/1", "1/1"],
  ["line after a closed fence remains inside Test plan", "## Test plan\n```\nFailure-cases: 9/9\n````\nFailure-cases: 1/1", "1/1"],
  ["later line outside section is ignored", "## Test plan\nFailure-cases: 2/3\n## Real money\nFailure-cases: 9/9", "2/3"],
]) {
  test(name, () => assert.deepEqual(failureCasesReport(body), { findings: [], value }));
}

test("the unfilled PR template fails until the author fills the line", () => {
  const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
  assert.match(failureCasesFindings(template)[0], /Malformed/);
  assert.deepEqual(failureCasesFindings(template.replace("Failure-cases: <tested>/<dependency calls>", "Failure-cases: 1/2")), []);
});

test("CLI accepts a valid body and rejects an invalid one and extra arguments", () => {
  const run = (body, args = []) => spawnSync(process.execPath, ["scripts/gates/failure-cases.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, PR_BODY: body },
  });
  const pass = run("## Test plan\nFailure-cases: 2/3");
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /## Failure cases\nFailure-cases: 2\/3\.\nFailure-cases gate passed\./);

  const fail = run("## Test plan\nFailure-cases: 3/2");
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /## Failure cases\n- Failure-cases tested count cannot exceed dependency calls; expected Failure-cases: <tested>\/<dependency calls>/);

  const usage = run("## Test plan\nFailure-cases: 2/3", ["extra"]);
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage:/);
});
