import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveBaseRef, testWeightFindings, testWeightReport } from "../test-weight.mjs";

function patch(path, additions = [], deletions = []) {
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,${deletions.length} +1,${additions.length} @@
${deletions.map((line) => `-${line}\n`).join("")}${additions.map((line) => `+${line}\n`).join("")}`;
}

const browser = "apps/web/tests/browser/nested/smoke.pw.ts";
const unit = "apps/web/client/screen.test.tsx";
const product = "apps/web/client/screen.tsx";
const verify = "apps/web/verify/cli.ts";

for (const [name, diff, title, body, expected] of [
  ["added top-level test requires a rung", patch(browser, ['test("a", () => {});']), "feat(ui): test", "", "Playwright-rung"],
  ["nested describe requires a rung", patch(browser, ['  test.describe("a", () => {']), "feat(ui): test", "", "Playwright-rung"],
  ["removed test does not require a rung", patch(browser, [], ['test("a", () => {});']), "feat(ui): test", "", ""],
  ["non-browser Playwright does not require a rung", patch("apps/web/tests/unit/smoke.pw.ts", ['test("a", () => {});']), "feat(ui): test", "", ""],
  ["commented browser call does not require a rung", patch(browser, ['// test("a", () => {});']), "feat(ui): test", "", ""],
  ["identifier containing test does not require a rung", patch(browser, ['contest("a");']), "feat(ui): test", "", ""],
  ["existing browser assertion does not require a rung", patch(browser, ["expect(1).toBe(1);"]), "feat(ui): test", "", ""],
  ["rename and restructure in one browser file requires no rung", patch(browser,
    ['test.describe("new group", () => {', 'test("renamed", () => {});'],
    ['test.describe("old group", () => {', 'test("old", () => {});']), "feat(ui): test", "", ""],
  ["genuinely added test alongside rename still requires rung", patch(browser,
    ['test("renamed", () => {});', 'test("new", () => {});'],
    ['test("old", () => {});']), "feat(ui): test", "", "Playwright-rung"],
  ["genuinely added test across browser files requires rung", patch(browser,
    ['test("renamed", () => {});', 'test("new", () => {});'])
    + patch("apps/web/tests/browser/old.pw.ts", [], ['test("old", () => {});']), "feat(ui): test", "", "Playwright-rung"],
  ["moving a test between browser files requires no rung", patch(browser,
    ['test("new", () => {});']) + patch("apps/web/tests/browser/old.pw.ts", [],
    ['test("removed", () => {});']), "feat(ui): test", "", ""],
  ["deleting a browser file and adding more declarations elsewhere requires rung", patch(browser,
    ['test("new", () => {});', 'test("extra", () => {});'])
    + patch("apps/web/tests/browser/old.pw.ts", [], ['test("removed", () => {});'])
      .replace("+++ b/apps/web/tests/browser/old.pw.ts", "+++ /dev/null"),
    "feat(ui): test", "", "Playwright-rung"],
  ["rename across browser paths offsets its removed declaration", patch(browser,
    ['test("renamed", () => {});'], ['test("old", () => {});'])
    .replace(`--- a/${browser}`, "--- a/apps/web/tests/browser/old.pw.ts"), "feat(ui): test", "", ""],
  ["unscoped fix does not require weight", patch(unit, ["one", "two"]), "fix: test", "", ""],
  ["scoped fix exceeding product lines requires reason", patch(unit, ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["equal added test and product lines pass", patch(unit, ["one"]) + patch(product, ["one"]), "fix(ui): test", "", ""],
  ["removed product lines count", patch(unit, ["one", "two"]) + patch(product, ["one"], ["old"]), "fix(ui): test", "", ""],
  ["deleted product file lines count", patch(unit, ["one", "two"]) + patch(product, [], ["old", "old"]).replace(`+++ b/${product}`, "+++ /dev/null"), "fix(ui): test", "", ""],
  ["story test lines count", patch("apps/web/stories/screen.stories.tsx", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["regular browser assertion lines count", patch(browser, ["expect(1).toBe(1);", "expect(2).toBe(2);"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["test helper under tests does not count as product", patch(unit, ["one", "two"]) + patch("apps/web/tests/helpers/fixtures.ts", ["one"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["any file under tests counts as tests", patch("apps/web/tests/helpers/fixture-data.json", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["stories of any extension count as tests", patch("apps/web/client/screen.stories.mdx", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["fixtures module counts as tests, not product", patch("apps/web/shared/balances/fixtures.ts", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["shipped fixture-named product source counts as product", patch("apps/web/client/savings/savings-dialog-fixture.tsx", ["one", "two"]) + patch(unit, ["one"]), "fix(ui): test", "", ""],
  ["oxlint test files count as tests", patch("apps/web/oxlint/tests/rule.ts", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["mjs tests count as tests", patch("apps/web/client/screen.test.mjs", ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["status paths are not exempt without a convention", patch("apps/web/shared/actions/status.test.ts", ["one", "two"]) + patch("apps/web/shared/actions/status.ts", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["amount paths are not exempt without a convention", patch("apps/web/shared/amount/parse.test.ts", ["one", "two"]) + patch("apps/web/shared/amount/parse.ts", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["non-web files do not contribute", patch(unit, ["one", "two"]) + patch(product, ["one"]) + patch("scripts/gates/test-weight.mjs", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["JavaScript test files are outside the TypeScript count", patch("apps/web/client/screen.test.js", ["one"]), "fix(ui): test", "", ""],
  ["README lines do not count as product", patch(unit, ["one", "two"]) + patch(product, ["one"]) + patch("apps/web/README.md", ["one", "two"]), "fix(ui): test", "", "Test-weight"],
]) {
  test(name, () => {
    const findings = testWeightFindings(diff, title, body);
    assert.equal(findings.length > 0, Boolean(expected));
    if (expected) assert.ok(findings.some((finding) => finding.includes(expected)));
  });
}

for (const [name, diff, title, rung, weight, counts] of [
  ["#718 test-only fix", patch(browser, ["const state = 1;", "expect(state).toBe(1);"]), "fix(browser-smoke): stabilize test", false, false, [0, 2, 0]],
  ["#761 verify fix", patch("apps/web/verify/cli.test.ts", Array(41).fill("expect(1).toBe(1);"))
    + patch("apps/web/verify/live.test.ts", ["expect(1).toBe(1);", "expect(2).toBe(2);"])
    + patch(verify, Array(16).fill("const value = 1;")), "fix(verify): confirm", false, true, [0, 43, 16]],
  ["#760 funding fix", patch(browser, ['test("sheet", () => {});', ...Array(40).fill("expect(1).toBe(1);")])
    + patch(unit, Array(34).fill("expect(1).toBe(1);")) + patch(product, ["const open = true;"]), "fix(funding): keep sheet open", true, true, [1, 75, 1]],
  ["#757 recipient feature", patch("apps/web/tests/browser/send-recipients.pw.ts", Array(3).fill('test("recipient", () => {});'))
    + patch(product, ["const recipient = true;"]), "feat(send): names", true, false, [3, 3, 1]],
  ["#784 move", patch(browser, Array(17).fill('test("moved", () => {});'))
    + patch("apps/web/tests/browser/old.pw.ts", [], Array(19).fill('test("old", () => {});')),
  "test(browser): split smoke", false, false, [0, 17, 0]],
]) {
  test(`${name} keeps the two checks independent`, () => {
    const report = testWeightReport(diff, title, "");
    assert.deepEqual([report.netNewPlaywright, report.addedTests, report.productLines], counts);
    assert.equal(testWeightFindings(diff, title, "", "rung").length > 0, rung);
    assert.equal(testWeightFindings(diff, title, "", "weight").length > 0, weight);
    assert.equal(report.findings.length, Number(rung) + Number(weight));
  });
}

test("verify test source is not product, while non-test verify source is", () => {
  const report = testWeightReport(patch("apps/web/verify/cli.test.ts", ["test", "test"])
    + patch(verify, ["new"], ["old"]), "fix(verify): test", "");
  assert.deepEqual([report.addedTests, report.productLines], [2, 2]);
  assert.deepEqual(report.findings, []);
});

test("verify test-fixture helpers count as test, not product", () => {
  const report = testWeightReport(patch("apps/web/verify/cli.test.ts", ["a", "b", "c"])
    + patch("apps/web/verify/test-fixtures/fake-agent-browser.ts", ["d", "e", "f"])
    + patch(verify, ["new"]), "fix(verify): fixture", "");
  assert.deepEqual([report.addedTests, report.productLines], [6, 1]);
  assert.equal(report.findings.length, 1);
});

test("the report counts test lines and the positive browser delta across files", () => {
  const report = testWeightReport(
    patch(browser, ['test("new", () => {});', "expect(1).toBe(1);"], ['test("old", () => {});'])
      + patch("apps/web/tests/browser/second.pw.ts", ['test.describe("new", () => {'])
      + patch(product, ["product"], ["old product"]),
    "fix(ui): test", "Playwright-rung: journey",
  );
  assert.deepEqual(report, {
    findings: ["Scoped fix adds 3 test lines versus 2 added/deleted product lines; add a PR-body line Test-weight: <reason>."],
    netNewPlaywright: 1,
    addedTests: 3,
    productLines: 2,
  });
});

test("the report cancels equal additions and removals across browser files", () => {
  const report = testWeightReport(
    patch(browser, ['test("moved", () => {});'])
      + patch("apps/web/tests/browser/old.pw.ts", [], ['test("original", () => {});']),
    "feat(ui): test", "",
  );
  assert.equal(report.netNewPlaywright, 0);
  assert.deepEqual(report.findings, []);
});

for (const rung of ["layout", "scrolling", "focus", "history", "persisted-state", "media-query", "hydration", "dispatch", "journey"]) {
  test(`accepts Playwright rung ${rung}`, () => {
    assert.deepEqual(testWeightFindings(patch(browser, ['test("a", () => {});']), "feat(ui): test", `Playwright-rung: ${rung}`), []);
  });
}

for (const body of ["Playwright-rung: FOCUS", "Playwright-Rung: focus", "Playwright-rung: other", "Playwright-rung:", "note Playwright-rung: focus", "Playwright-rung: focus extra"]) {
  test(`rejects invalid rung line ${JSON.stringify(body)}`, () => {
    assert.match(testWeightFindings(patch(browser, ['test("a", () => {});']), "feat(ui): test", body)[0], /Playwright-rung/);
  });
}

for (const body of ["Test-weight: fixture coverage", "## Evidence\nTest-weight: journey requires extra fixtures\n"]) {
  test(`accepts reason ${JSON.stringify(body)}`, () => {
    assert.deepEqual(testWeightFindings(patch(unit, ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", body), []);
  });
}

for (const body of ["Test-weight:", "note Test-weight: coverage"]) {
  test(`rejects missing reason ${JSON.stringify(body)}`, () => {
    assert.match(testWeightFindings(patch(unit, ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", body)[0], /Test-weight/);
  });
}

test("a scoped fix with a browser call and product code needs both declarations", () => {
  const diff = patch(browser, ['test("a", () => {});', "expect(1).toBe(1);"]) + patch(product, ["one"]);
  assert.equal(testWeightFindings(diff, "fix(ui): test", "").length, 2);
  assert.deepEqual(testWeightFindings(diff, "fix(ui): test", "Playwright-rung: journey\nTest-weight: browser dispatch requires fixtures"), []);
});

test("selectors reject unknown checks", () => {
  assert.throws(() => testWeightReport("", "", "", "other"), /Unknown test-weight check/);
  const cli = spawnSync(process.execPath, ["scripts/gates/test-weight.mjs", "--check=other"], { encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Usage:/);
});

test("uses an existing base ref without fetching", () => {
  const calls = [];
  const gitRunner = (args) => { calls.push(args); return ""; };
  assert.equal(resolveBaseRef({ base: "main", gitRunner }), "origin/main");
  assert.deepEqual(calls, [["rev-parse", "--verify", "origin/main"]]);
});

test("fetches and retries when the remote base ref is missing", () => {
  const calls = [];
  let verifyAttempts = 0;
  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse" && verifyAttempts++ === 0) throw new Error("missing ref");
    return "";
  };
  assert.equal(resolveBaseRef({ base: "main", gitRunner }), "origin/main");
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "origin/main"],
    ["fetch", "--no-tags", "--depth=200", "origin", "main"],
    ["rev-parse", "--verify", "origin/main"],
  ]);
});

for (const failure of ["rev-parse", "fetch"]) {
  test(`reports an unresolved base ref after ${failure} fails`, () => {
    const gitRunner = (args) => {
      if (args[0] === "rev-parse" || args[0] === failure) throw new Error("missing ref");
      return "";
    };
    assert.throws(() => resolveBaseRef({ base: "main", gitRunner }), /could not resolve base ref origin\/main/);
  });
}
