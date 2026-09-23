import assert from "node:assert/strict";
import test from "node:test";
import { testWeightFindings } from "../test-weight.mjs";

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

for (const [name, diff, title, body, expected] of [
  ["added top-level test requires a rung", patch(browser, ['test("a", () => {});']), "feat(ui): test", "", "Playwright-rung"],
  ["nested describe requires a rung", patch(browser, ['  test.describe("a", () => {']), "feat(ui): test", "", "Playwright-rung"],
  ["removed test does not require a rung", patch(browser, [], ['test("a", () => {});']), "feat(ui): test", "", ""],
  ["non-browser Playwright does not require a rung", patch("apps/web/tests/unit/smoke.pw.ts", ['test("a", () => {});']), "feat(ui): test", "", ""],
  ["commented browser call does not require a rung", patch(browser, ['// test("a", () => {});']), "feat(ui): test", "", ""],
  ["identifier containing test does not require a rung", patch(browser, ['contest("a");']), "feat(ui): test", "", ""],
  ["existing browser assertion does not require a rung", patch(browser, ["expect(1).toBe(1);"]), "feat(ui): test", "", ""],
  ["unscoped fix does not require weight", patch(unit, ["one", "two"]), "fix: test", "", ""],
  ["scoped fix exceeding product lines requires reason", patch(unit, ["one", "two"]) + patch(product, ["one"]), "fix(ui): test", "", "Test-weight"],
  ["equal added test and product lines pass", patch(unit, ["one"]) + patch(product, ["one"]), "fix(ui): test", "", ""],
  ["removed product lines count", patch(unit, ["one", "two"]) + patch(product, ["one"], ["old"]), "fix(ui): test", "", ""],
  ["deleted product file lines count", patch(unit, ["one", "two"]) + patch(product, [], ["old", "old"]).replace(`+++ b/${product}`, "+++ /dev/null"), "fix(ui): test", "", ""],
  ["story test lines count", patch("apps/web/stories/screen.stories.tsx", ["one", "two"]), "fix(ui): test", "", "Test-weight"],
  ["regular browser assertion lines count", patch(browser, ["expect(1).toBe(1);"]), "fix(ui): test", "", "Test-weight"],
  ["test helper under tests does not count as product", patch(unit, ["one", "two"]) + patch("apps/web/tests/helpers/fixtures.ts", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["status paths are not exempt without a convention", patch("apps/web/shared/actions/status.test.ts", ["one", "two"]) + patch("apps/web/shared/actions/status.ts", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["amount paths are not exempt without a convention", patch("apps/web/shared/amount/parse.test.ts", ["one", "two"]) + patch("apps/web/shared/amount/parse.ts", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["non-web files do not contribute", patch(unit, ["one"]) + patch("scripts/gates/test-weight.mjs", ["one"]), "fix(ui): test", "", "Test-weight"],
  ["JavaScript test files are outside the TypeScript count", patch("apps/web/client/screen.test.js", ["one"]), "fix(ui): test", "", ""],
  ["README lines do not count as product", patch(unit, ["one", "two"]) + patch("apps/web/README.md", ["one", "two"]), "fix(ui): test", "", "Test-weight"],
]) {
  test(name, () => {
    const findings = testWeightFindings(diff, title, body);
    assert.equal(findings.length > 0, Boolean(expected));
    if (expected) assert.ok(findings.some((finding) => finding.includes(expected)));
  });
}

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
    assert.deepEqual(testWeightFindings(patch(unit, ["one", "two"]), "fix(ui): test", body), []);
  });
}

for (const body of ["Test-weight:", "note Test-weight: coverage"]) {
  test(`rejects missing reason ${JSON.stringify(body)}`, () => {
    assert.match(testWeightFindings(patch(unit, ["one", "two"]), "fix(ui): test", body)[0], /Test-weight/);
  });
}

test("a scoped fix with a browser call needs both declarations", () => {
  assert.equal(testWeightFindings(patch(browser, ['test("a", () => {});']), "fix(ui): test", "").length, 2);
  assert.deepEqual(testWeightFindings(patch(browser, ['test("a", () => {});']), "fix(ui): test", "Playwright-rung: journey\nTest-weight: browser dispatch requires fixtures"), []);
});
